#!/usr/bin/env node
import * as path from 'path';
import { WORKSPACES_DIR } from '../../utils/config';
import { loadMetadata } from '../../utils/workspace-meta';
import { mergeBranch } from '../../utils/branch-operations';
import { logError, logInfo, logStep, logSuccess, logWarning } from '../../utils/logger';
import { colorize } from '../../utils/colors';


export const main = async (opts?: { workspace?: string; source?: string; target?: string; noFf?: boolean; ffOnly?: boolean; squash?: boolean }) => {
  try {
    const workspaceName = opts?.workspace ?? process.argv[2];
    const sourceBranch = opts?.source ?? process.argv[3];
    const targetBranch = opts?.target ?? process.argv[4];

    if (!workspaceName || !sourceBranch || !targetBranch) {
      logError('Usage: workspace branch-merge <workspace> <source-branch> <target-branch> [--no-ff|--ff-only|--squash]');
      process.exit(1);
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    const options = {
      noFf: opts?.noFf ?? process.argv.includes('--no-ff'),
      ffOnly: opts?.ffOnly ?? process.argv.includes('--ff-only'),
      squash: opts?.squash ?? process.argv.includes('--squash'),
    };

    logStep(`Merging ${colorize(sourceBranch, 'cyan')} into ${colorize(targetBranch, 'cyan')}...`);

    const results = [];
    for (const repo of metadata.repositories) {
      const repoPath = path.join(workspacePath, repo.name);
      const result = await mergeBranch(repoPath, repo.name, sourceBranch, targetBranch, options);
      results.push(result);

      if (result.success) {
        logSuccess(`${repo.name}: ${result.message}`);
      } else {
        logWarning(`${repo.name}: ${result.message} - ${result.error || ''}`);
      }
    }

    const successful = results.filter(r => r.success).length;
    logInfo(`Merged successfully in ${successful}/${results.length} repositories`);
  } catch (error) {
    logError('Failed to merge branches');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
};

if (require.main === module) main();
