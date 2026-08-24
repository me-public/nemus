#!/usr/bin/env node
import * as path from 'path';
import { listWorkspaces, loadMetadata } from '../../utils/workspace-meta';
import { promptWorkspaceSelection } from '../../utils/prompts';
import { createBranch } from '../../utils/branch-operations';
import { logError, logInfo, logStep, logSuccess, logWarning } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { WORKSPACES_DIR } from '../../utils/config';
import inquirer from 'inquirer';

export interface BranchCreateOpts {
  workspace?: string;
  branch?: string;
  base?: string;
  force?: boolean;
}

export const main = async (opts?: BranchCreateOpts) => {
  try {
    let workspaceName = opts?.workspace;
    let branchName = opts?.branch;
    const baseBranch = opts?.base;
    const force = opts?.force ?? false;

    // Resolve workspace interactively if needed
    if (!workspaceName) {
      if (!process.stdout.isTTY) {
        logError('Missing required option: --workspace');
        logError('Usage: w branch create --workspace <name> --branch <branch>');
        process.exit(1);
      }
      const workspaces = await listWorkspaces();
      workspaceName = await promptWorkspaceSelection(workspaces);
    }

    // Resolve branch interactively if needed
    if (!branchName) {
      if (!process.stdout.isTTY) {
        logError('Missing required option: --branch');
        logError('Usage: w branch create --workspace <name> --branch <branch>');
        process.exit(1);
      }
      const { branch } = await inquirer.prompt([
        {
          type: 'input',
          name: 'branch',
          message: 'New branch name:',
          validate: (input: string) => input.trim() ? true : 'Branch name cannot be empty',
        },
      ]);
      branchName = branch;
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName!);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    logStep(`Creating branch ${colorize(branchName!, 'cyan')} across all repositories...`);

    const results = [];
    for (const repo of metadata.repositories) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await createBranch(repoPath, repo.directoryName, branchName!, baseBranch, force);
      results.push(result);

      if (result.success) {
        logSuccess(`${repo.directoryName}: ${result.message}`);
      } else {
        logWarning(`${repo.directoryName}: ${result.message}`);
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('');
    logInfo(`Created branches in ${successful}/${results.length} repositories`);
    if (failed > 0) {
      logWarning(`${failed} repositories were skipped or failed`);
    }
  } catch (error) {
    logError('Failed to create branches');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
};

if (require.main === module) main();
