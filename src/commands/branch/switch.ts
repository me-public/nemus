#!/usr/bin/env ts-node

import { WORKSPACES_DIR } from '../../utils/config';
import * as path from 'path';
import { listWorkspaces, loadMetadata } from '../../utils/workspace-meta';
import { promptWorkspaceSelection } from '../../utils/prompts';
import { logInfo, logSuccess, logError, logWarning } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { switchBranch, BranchSwitchResult } from '../../utils/branch-operations';
import inquirer from 'inquirer';

export interface BranchSwitchOpts {
  workspace?: string;
  branch?: string;
  yes?: boolean;
}

export async function main(opts?: BranchSwitchOpts) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Bulk Branch Switch', 'bright'));
  console.log('='.repeat(60) + '\n');

  const yes = opts?.yes ?? false;

  try {
    // Select workspace
    let workspaceName: string;

    if (opts?.workspace) {
      workspaceName = opts.workspace;
    } else {
      if (!process.stdout.isTTY) {
        logError('Missing required option: --workspace');
        logError('Usage: w branch switch --workspace <name> --branch <branch>');
        process.exit(1);
      }
      const workspaces = await listWorkspaces();
      workspaceName = await promptWorkspaceSelection(workspaces);
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    logInfo(`Selected workspace: ${colorize(workspaceName, 'cyan')}`);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      logError('No metadata found for this workspace');
      process.exit(1);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    console.log(`\nFound ${repos.length} repositories\n`);

    // Determine target branch
    let targetBranch: string;

    if (opts?.branch) {
      targetBranch = opts.branch;
    } else {
      if (!process.stdout.isTTY) {
        logError('Missing required option: --branch');
        logError('Usage: w branch switch --workspace <name> --branch <branch>');
        process.exit(1);
      }
      const { branch } = await inquirer.prompt([
        {
          type: 'input',
          name: 'branch',
          message: 'Target branch name:',
          default: 'main',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Branch name cannot be empty';
            }
            return true;
          },
        },
      ]);
      targetBranch = branch;
    }

    logWarning(`This will switch all repositories to branch: ${colorize(targetBranch, 'cyan')}`);

    // Skip confirmation when --yes flag is provided
    if (!yes && process.stdout.isTTY) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Proceed with bulk branch switch?',
          default: true,
        },
      ]);

      if (!confirmed) {
        logInfo('Branch switch cancelled');
        process.exit(0);
      }
    }

    console.log('');
    const results: BranchSwitchResult[] = [];
    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const displayName = repo.directoryName !== repo.name
        ? `${repo.directoryName} (${repo.name})`
        : repo.name;
      const result = await switchBranch(repoPath, displayName, targetBranch);
      results.push(result);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Branch Switch Results Summary');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    const skipped = results.filter(r => r.status === 'skipped');

    console.log(`${colorize('✓', 'green')} Switched: ${successful.length}`);
    console.log(`${colorize('✗', 'red')} Failed: ${failed.length}`);
    console.log(`${colorize('○', 'yellow')} Skipped: ${skipped.length}`);
    console.log('='.repeat(60));

    if (failed.length > 0) {
      console.log('\nFailed repositories:');
      failed.forEach(result => {
        console.log(`  ${colorize('✗', 'red')} ${result.repo}: ${result.message}`);
      });
    }

    if (skipped.length > 0) {
      console.log('\nSkipped repositories:');
      skipped.forEach(result => {
        console.log(`  ${colorize('○', 'yellow')} ${result.repo}: ${result.message}`);
      });
    }

    console.log('');
    logSuccess('Bulk branch switch complete!');

  } catch (error) {
    logError('Failed to switch branches');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
