import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR, getCloneUrl } from '../utils/config';
import { verifyGhAuth, fetchOrgRepos, displayAuthInstructions } from '../utils/github';
import { promptRepositorySelection, promptWorkspaceSelection } from '../utils/prompts';
import { cloneRepositories, reportCloneResults } from '../utils/git-operations';
import { warnIfGhqMissing } from '../utils/ghq-integration';
import { loadMetadata, saveMetadata, listWorkspaces } from '../utils/workspace-meta';
import { logInfo, logSuccess, logError, logStep, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { getGlobalOpts, resolveWorkspace, parseList } from '../utils/command-helpers';
import { resolveRepoSpecs } from '../utils/repo-resolver';

export function registerUpdateCommand(parent: Command) {
  parent
    .command('update')
    .alias('u')
    .description('Add repositories to an existing workspace')
    .option('-w, --workspace <name>', 'Workspace name')
    .option('-r, --repos <repos>', 'Comma-separated repository names. Add a suffix to clone the same repo again under a separate folder, e.g. casper:cas-101 -> casper-cas-101')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleUpdate({ ...opts, ...globalOpts });
    });
}

async function handleUpdate(opts: {
  workspace?: string;
  repos?: string;
  forceRefresh: boolean;
  yes: boolean;
}) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Update Workspace', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Verify gh CLI authentication
    logStep(1, 5, 'Verifying GitHub CLI authentication...');
    const isAuthenticated = await verifyGhAuth();

    if (!isAuthenticated) {
      logError('GitHub CLI is not authenticated');
      displayAuthInstructions();
      process.exit(1);
    }

    logSuccess('GitHub CLI authenticated');

    // Step 2: List and select workspace
    logStep(2, 5, 'Select workspace to update...');
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    logInfo(`Selected workspace: ${colorize(workspaceName, 'cyan')}`);

    // Load existing metadata
    const metadata = await loadMetadata(workspacePath);
    const existingDirectoryNames = metadata?.repositories.map(r => r.directoryName) || [];
    // Duplicate detection is by directory name (the actual folder). The same
    // repo CAN be added again under a different suffix (e.g. casper:cas-101 ->
    // casper-cas-101), so we must NOT block on the canonical repo name.
    const existingDirSet = new Set(existingDirectoryNames);

    console.log(`\nCurrent repositories: ${existingDirectoryNames.length}`);
    metadata?.repositories.forEach(r => {
      const displayName = r.directoryName !== r.name
        ? `${r.directoryName} (${r.name})`
        : r.name;
      console.log(`  - ${displayName}`);
    });
    console.log('');

    // Step 3: Fetch all available repos
    logStep(3, 5, 'Fetching repositories...');
    const allRepos = await fetchOrgRepos({ forceRefresh: opts.forceRefresh });

    if (allRepos.length === 0) {
      logError('No repositories found');
      process.exit(1);
    }

    // Step 4: Select new repositories to add
    logStep(4, 5, 'Select additional repositories to clone...');

    let selectedEntries;

    if (opts.repos) {
      const repoSpecs = parseList(opts.repos);
      const { resolved, notFound, invalidSuffix } = resolveRepoSpecs(repoSpecs, allRepos);

      if (invalidSuffix.length > 0) {
        logError(`Invalid instance suffix in: ${invalidSuffix.join(', ')}`);
        logInfo('Use repo:suffix (e.g. casper:cas-101). Suffix may contain letters, numbers, hyphens, underscores.');
        process.exit(1);
      }

      // Warn about fuzzy-resolved names
      for (const r of resolved) {
        if (!r.exact) logWarning(`Repo "${r.input}" not found exactly — using "${r.repo.name}" (best match)`);
      }

      const duplicates = resolved.filter(r => existingDirSet.has(r.directoryName));
      selectedEntries = resolved
        .filter(r => !existingDirSet.has(r.directoryName))
        .map(r => ({ repo: r.repo, directoryName: r.directoryName }));

      if (duplicates.length > 0) {
        logWarning(`Skipping entries whose directory already exists: ${duplicates.map(r => r.directoryName).join(', ')}`);
      }
      if (notFound.length > 0) {
        logError(`Repositories not found: ${notFound.join(', ')}`);
        process.exit(1);
      }
    } else {
      console.log(`\n${allRepos.length} repositories available to add\n`);
      selectedEntries = await promptRepositorySelection(allRepos, existingDirectoryNames);
    }

    if (selectedEntries.length === 0) {
      logInfo('No new repositories selected');
      process.exit(0);
    }

    logInfo(`Selected ${selectedEntries.length} new repositories to add`);

    // Step 5: Clone new repositories
    logStep(5, 5, 'Cloning new repositories...');

    await warnIfGhqMissing();
    const cloneResults = await cloneRepositories(selectedEntries!, workspacePath);

    // Update metadata — create from scratch if the workspace had none
    const newRepoMetadata = cloneResults.map(result => ({
      name: result.repo.name,
      directoryName: result.directoryName,
      owner: result.repo.owner.login,
      clonedAt: result.clonedAt || new Date().toISOString(),
      cloneUrl: getCloneUrl(result.repo),
      status: result.status as 'success' | 'failed',
      error: result.error,
    }));

    if (metadata) {
      metadata.repositories.push(...newRepoMetadata);
      metadata.lastModified = new Date().toISOString();
      await saveMetadata(workspacePath, metadata);
    } else {
      // Workspace had no metadata file — create one now
      const fresh = {
        workspaceName,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        repositories: newRepoMetadata,
      };
      await saveMetadata(workspacePath, fresh);
    }

    // Report results
    reportCloneResults(cloneResults);

    const totalRepos = existingDirectoryNames.length + cloneResults.filter(r => r.status === 'success').length;
    console.log(`Workspace now has ${colorize(String(totalRepos), 'cyan')} repositories\n`);

    logSuccess('Workspace updated successfully!');

  } catch (error) {
    logError('Failed to update workspace');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
