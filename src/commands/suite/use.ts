#!/usr/bin/env ts-node

import * as fs from 'fs/promises';
import * as path from 'path';
import { WORKSPACES_DIR } from '../../utils/config';
import { fetchOrgRepos, verifyGhAuth, displayAuthInstructions } from '../../utils/github';
import { promptWorkspaceName, confirmWorkspaceCreation } from '../../utils/prompts';
import { cloneRepositories, reportCloneResults } from '../../utils/git-operations';
import { createMetadata, saveMetadata } from '../../utils/workspace-meta';
import { generateClaudeContext } from '../../utils/claude-integration';
import { logInfo, logSuccess, logError, logStep } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { listSuites } from '../../utils/suite';
import { runPostCloneHooks } from '../../utils/hooks';
import { GitHubRepo } from '../../types';
import inquirer from 'inquirer';
import { validateWorkspaceName, checkWorkspaceExists, sanitizeWorkspaceName, resolveWorkspaceNameConflict } from '../../utils/validation';

export interface SuiteUseOpts {
  suite?: string;
  workspace?: string;
  yes?: boolean;
  forceRefresh?: boolean;
}

export async function main(opts?: SuiteUseOpts) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Create Workspace from Suite', 'bright'));
  console.log('='.repeat(60) + '\n');

  // Read from opts (Commander) or fall back to process.argv (legacy/direct)
  const suiteFlag = opts?.suite;
  const workspaceFlag = opts?.workspace;
  const yes = opts?.yes ?? false;
  const nonInteractive = !process.stdout.isTTY;

  try {
    // Step 1: Load suites
    logStep(1, 7, 'Loading suites...');
    const suites = await listSuites();

    if (suites.length === 0) {
      logError('No suites found. Create one first with: workspace suite-create');
      process.exit(1);
    }

    logSuccess(`Found ${suites.length} suite(s)`);

    // Step 2: Select suite
    logStep(2, 7, 'Select suite...');
    if (!suiteFlag && nonInteractive) {
      logError("Missing required option: --suite"); logError("Usage: w suite use --suite <name> --workspace <name>");
      process.exit(1);
    }

    let selectedSuite: typeof suites[0];

    if (suiteFlag) {
      const found = suites.find(s => s.name === suiteFlag);
      if (!found) {
        logError(`Suite not found: ${suiteFlag}`);
        logError(`Available suites: ${suites.map(s => s.name).join(', ')}`);
        process.exit(1);
      }
      selectedSuite = found;
    } else {
      const { suite } = await inquirer.prompt([
        {
          type: 'list',
          name: 'suite',
          message: 'Select a suite:',
          choices: suites.map(s => ({
            name: `${s.name} (${s.entries.length} repos)${s.description ? ` - ${s.description}` : ''}`,
            value: s,
            short: s.name,
          })),
          pageSize: 15,
        },
      ]);
      selectedSuite = suite;
    }

    console.log(`\n${colorize('Suite repositories:', 'cyan')} ${selectedSuite.entries.length}`);
    for (const entry of selectedSuite.entries) {
      const alias = entry.directoryName !== entry.repoName ? ` (${entry.repoName})` : '';
      console.log(`  - ${entry.directoryName}${alias}`);
    }
    console.log('');

    // Step 3: Verify gh CLI authentication
    logStep(3, 7, 'Verifying GitHub CLI authentication...');
    const isAuthenticated = await verifyGhAuth();

    if (!isAuthenticated) {
      logError('GitHub CLI is not authenticated');
      displayAuthInstructions();
      process.exit(1);
    }

    logSuccess('GitHub CLI authenticated');

    // Step 4: Fetch repos and resolve suite entries
    logStep(4, 7, 'Fetching repositories...');
    const forceRefresh = opts?.forceRefresh ?? false;
    const allRepos = await fetchOrgRepos({ forceRefresh });
    const repoMap = new Map(allRepos.map(repo => [repo.name, repo]));

    const resolvedEntries: Array<{ repo: GitHubRepo; directoryName: string }> = [];
    const missing: string[] = [];

    for (const entry of selectedSuite.entries) {
      const repo = repoMap.get(entry.repoName);
      if (repo) {
        resolvedEntries.push({ repo, directoryName: entry.directoryName });
      } else {
        missing.push(entry.repoName);
      }
    }

    if (missing.length > 0) {
      logInfo(`${missing.length} repositories from suite not found or not accessible:`);
      missing.forEach(name => console.log(`  - ${colorize(name, 'yellow')}`));
      console.log('');
    }

    if (resolvedEntries.length === 0) {
      logError('No repositories from the suite are available');
      process.exit(1);
    }

    logInfo(`${resolvedEntries.length} repositories will be cloned`);

    // Step 5: Workspace name
    logStep(5, 7, 'Enter workspace name...');
    if (!workspaceFlag && nonInteractive) {
      logError("Missing required option: --workspace"); logError("Usage: w suite use --suite <name> --workspace <name>");
      process.exit(1);
    }

    let workspaceName: string;

    if (workspaceFlag) {
      workspaceName = sanitizeWorkspaceName(workspaceFlag);
      const validation = validateWorkspaceName(workspaceName);
      if (validation !== true) {
        logError(typeof validation === 'string' ? validation : 'Invalid workspace name');
        process.exit(1);
      }
      const exists = await checkWorkspaceExists(workspaceName);
      if (exists) {
        const repoNames = selectedSuite.entries.map(e => e.repoName);
        const resolved = await resolveWorkspaceNameConflict(workspaceName, repoNames);
        logInfo(`Workspace "${workspaceName}" already exists — using "${colorize(resolved, 'cyan')}" instead.`);
        workspaceName = resolved;
      }
    } else {
      workspaceName = await promptWorkspaceName();
      // Auto-resolve conflict in case the interactively chosen name already exists
      const interactiveExists = await checkWorkspaceExists(workspaceName);
      if (interactiveExists) {
        const repoNames = selectedSuite.entries.map(e => e.repoName);
        const resolved = await resolveWorkspaceNameConflict(workspaceName, repoNames);
        logInfo(`Workspace "${workspaceName}" already exists — using "${colorize(resolved, 'cyan')}" instead.`);
        workspaceName = resolved;
      }
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName!);

    // Step 6: Confirm creation
    logStep(6, 7, 'Confirm workspace creation...');
    if (!yes) {
      const confirmed = await confirmWorkspaceCreation(
        workspaceName!,
        resolvedEntries.length,
        workspacePath
      );

      if (!confirmed) {
        logInfo('Workspace creation cancelled');
        process.exit(0);
      }
    }

    // Step 7: Create workspace and clone repositories
    logStep(7, 7, 'Creating workspace from suite...');

    await fs.mkdir(workspacePath, { recursive: true });
    logSuccess(`Created workspace directory: ${workspacePath}`);

    const cloneResults = await cloneRepositories(resolvedEntries, workspacePath);

    const metadata = createMetadata(workspaceName!, cloneResults);
    await saveMetadata(workspacePath, metadata);

    reportCloneResults(cloneResults);

    if (selectedSuite.postCloneHooks?.length) {
      await runPostCloneHooks(
        workspacePath,
        metadata.repositories.filter(r => r.status === 'success'),
        selectedSuite.postCloneHooks
      );
    }

    const successfulRepos = cloneResults
      .filter(r => r.status === 'success')
      .map(r => r.repo);

    if (successfulRepos.length > 0) {
      logInfo('Setting up Claude Code integration...');
      await generateClaudeContext(workspacePath, workspaceName!, successfulRepos, metadata);
    }

    const tempFile = path.join(process.env.HOME || '~', '.workspace-last-created');
    try {
      await fs.writeFile(tempFile, workspacePath, 'utf-8');
    } catch {
      // Ignore errors writing temp file
    }

    logSuccess('Workspace created from suite successfully!');
  } catch (error) {
    logError('Failed to create workspace from suite');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
