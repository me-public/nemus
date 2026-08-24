#!/usr/bin/env node
import * as path from 'path';
import { WORKSPACES_DIR } from '../../utils/config';
import { loadMetadata } from '../../utils/workspace-meta';
import { rebaseBranch } from '../../utils/branch-operations';
import { logError, logInfo, logStep, logSuccess, logWarning } from '../../utils/logger';
import { colorize } from '../../utils/colors';


export const main = async (opts?: { workspace?: string; base?: string }) => {
  try {
    const workspaceName = opts?.workspace ?? process.argv[2];
    const targetBranch = opts?.base ?? process.argv[3];

    if (!workspaceName || !targetBranch) {
      logError('Usage: workspace branch-rebase <workspace> <target-branch>');
      process.exit(1);
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    logStep(`Rebasing onto ${colorize(targetBranch, 'cyan')}...`);

    const results = [];
    for (const repo of metadata.repositories) {
      const repoPath = path.join(workspacePath, repo.name);
      const result = await rebaseBranch(repoPath, repo.name, targetBranch);
      results.push(result);

      if (result.success) {
        logSuccess(`${repo.name}: ${result.message}`);
      } else {
        logWarning(`${repo.name}: ${result.message} - ${result.error || ''}`);
      }
    }

    const successful = results.filter(r => r.success).length;
    logInfo(`Rebased successfully in ${successful}/${results.length} repositories`);
  } catch (error) {
    logError('Failed to rebase branches');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
};

if (require.main === module) main();
