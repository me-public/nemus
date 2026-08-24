import { Command } from 'commander';
import { WORKSPACES_DIR } from '../utils/config';
import * as path from 'path';
import { verifyGhAuth, fetchOrgRepos, displayAuthInstructions } from '../utils/github';
import { promptRepositorySelection, promptWorkspaceName, confirmWorkspaceCreation, type RepoSelection } from '../utils/prompts';
import { cloneRepositories, reportCloneResults } from '../utils/git-operations';
import { warnIfGhqMissing } from '../utils/ghq-integration';
import { createMetadata, saveMetadata } from '../utils/workspace-meta';
import { generateClaudeContext } from '../utils/claude-integration';
import { logInfo, logSuccess, logError, logStep } from '../utils/logger';
import { colorize } from '../utils/colors';
import { printBanner } from '../utils/banner';
import { validateWorkspaceName, checkWorkspaceExists, sanitizeWorkspaceName, resolveWorkspaceNameConflict } from '../utils/validation';
import { getGlobalOpts, parseList } from '../utils/command-helpers';
import { resolveRepoSpecs } from '../utils/repo-resolver';

export function registerCreateCommand(parent: Command) {
  parent
    .command('create')
    .alias('c')
    .description('Create a new workspace')
    .option('-w, --workspace <name>', 'Workspace name')
    .option('-r, --repos <repos>', 'Comma-separated repository names. Use repo:suffix to add the same repo more than once under a separate folder, e.g. casper:cas-101 -> casper-cas-101')
    .option('--prompt <prompt>', 'Original prompt that triggered workspace creation (saved to metadata)')
    .option('--allow-empty', 'Create the workspace with no repositories (e.g. investigate-first: the agent adds repos later)')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleCreate({ ...opts, ...globalOpts });
    });
}

async function handleCreate(opts: {
  workspace?: string;
  repos?: string;
  prompt?: string;
  allowEmpty?: boolean;
  forceRefresh: boolean;
  yes: boolean;
}) {
  printBanner();

  try {
    // Step 1: Verify gh CLI authentication
    logStep(1, 6, 'Verifying GitHub CLI authentication...');
    const isAuthenticated = await verifyGhAuth();

    if (!isAuthenticated) {
      logError('GitHub CLI is not authenticated');
      displayAuthInstructions();
      process.exit(1);
    }

    logSuccess('GitHub CLI authenticated');

    // Investigate-first empty workspace: no repos to resolve, so skip the org
    // catalog fetch entirely — otherwise an empty/failed catalog would abort
    // creation on the guard below even though we need no repos.
    const investigateEmpty = !!opts.allowEmpty && !opts.repos;

    // Step 2: Fetch repositories (only when we actually need to resolve repos)
    let repos: Awaited<ReturnType<typeof fetchOrgRepos>> = [];
    if (!investigateEmpty) {
      logStep(2, 6, 'Fetching repositories...');
      repos = await fetchOrgRepos({ forceRefresh: opts.forceRefresh });

      if (repos.length === 0) {
        logError('No repositories found');
        process.exit(1);
      }
    }

    // Step 3: Select repositories
    logStep(3, 6, 'Select repositories to clone...');
    let selectedEntries: RepoSelection[];

    if (investigateEmpty) {
      // Investigate-first: start with no repos; the in-session agent discovers
      // and adds the relevant repos itself.
      logInfo('Creating an empty workspace (no repositories) — repos can be added later.');
      selectedEntries = [];
    } else if (opts.repos) {
      const repoSpecs = parseList(opts.repos);
      const { resolved, notFound, invalidSuffix } = resolveRepoSpecs(repoSpecs, repos);

      if (invalidSuffix.length > 0) {
        logError(`Invalid instance suffix in: ${invalidSuffix.join(', ')}`);
        logInfo('Use repo:suffix (e.g. casper:cas-101). Suffix may contain letters, numbers, hyphens, underscores.');
        process.exit(1);
      }

      // Warn about fuzzy-resolved names so the user knows what was used
      for (const r of resolved) {
        if (!r.exact) {
          logInfo(`Repo "${r.input}" not found exactly — using "${colorize(r.repo.name, 'cyan')}" (best match)`);
        }
      }

      if (notFound.length > 0) {
        logError(`Repositories not found: ${notFound.join(', ')}`);
        process.exit(1);
      }

      selectedEntries = resolved.map(r => ({ repo: r.repo, directoryName: r.directoryName }));
    } else {
      selectedEntries = await promptRepositorySelection(repos);
    }

    if (selectedEntries.length === 0 && !opts.allowEmpty) {
      logInfo('No repositories selected');
      return;
    }

    // Step 4: Get workspace name
    logStep(4, 6, 'Configure workspace...');
    let workspaceName: string;

    if (opts.workspace) {
      workspaceName = sanitizeWorkspaceName(opts.workspace);
      const nameError = validateWorkspaceName(workspaceName);
      if (nameError !== true) {
        logError(typeof nameError === 'string' ? nameError : 'Invalid workspace name');
        process.exit(1);
      }
      const exists = await checkWorkspaceExists(workspaceName);
      if (exists) {
        const resolved = await resolveWorkspaceNameConflict(workspaceName, selectedEntries.map(e => e.directoryName));
        logInfo(`Workspace "${workspaceName}" already exists — using "${colorize(resolved, 'cyan')}" instead.`);
        workspaceName = resolved;
      }
    } else {
      workspaceName = await promptWorkspaceName();
      // Auto-resolve conflict in case the interactively chosen name already exists
      // (the prompt validates format but not uniqueness at this point)
      const interactiveExists = await checkWorkspaceExists(workspaceName);
      if (interactiveExists) {
        const resolved = await resolveWorkspaceNameConflict(workspaceName, selectedEntries.map(e => e.directoryName));
        logInfo(`Workspace "${workspaceName}" already exists — using "${colorize(resolved, 'cyan')}" instead.`);
        workspaceName = resolved;
      }
    }

    // Step 5: Confirm
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    if (!opts.yes) {
      const confirmed = await confirmWorkspaceCreation(workspaceName, selectedEntries.length, workspacePath);
      if (!confirmed) {
        logInfo('Operation cancelled');
        return;
      }
    }

    // Step 6: Clone repositories
    logStep(5, 6, 'Creating workspace...');
    const { mkdir } = await import('fs/promises');
    await mkdir(workspacePath, { recursive: true });

    if (selectedEntries.length > 0) await warnIfGhqMissing();
    const results = await cloneRepositories(selectedEntries, workspacePath);
    reportCloneResults(results);

    // Step 7: Save metadata & generate context
    logStep(6, 6, 'Saving workspace metadata...');
    const metadata = createMetadata(workspaceName, results, { prompt: opts.prompt });
    await saveMetadata(workspacePath, metadata);

    const successfulRepos = results
      .filter(r => r.status === 'success')
      .map(r => r.repo);

    // Generate context + .mcp.json even for an empty (investigate-first)
    // workspace, so the in-session agent lands with the MCP tools (search-repos
    // / update-workspace) needed to discover and add repos.
    if (successfulRepos.length > 0 || opts.allowEmpty) {
      await generateClaudeContext(workspacePath, workspaceName, successfulRepos, metadata);
    }

    logSuccess(`Workspace "${colorize(workspaceName, 'cyan')}" created successfully!`);

    // Write workspace path to temp file for shell integration auto-CD
    const { writeFile } = await import('fs/promises');
    const os = await import('os');
    const tempFile = path.join(os.homedir(), '.workspace-last-created');
    try {
      await writeFile(tempFile, workspacePath, 'utf-8');
    } catch {
      // Non-critical — shell integration CD won't work but workspace was created
    }

  } catch (error) {
    logError('Failed to create workspace');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
