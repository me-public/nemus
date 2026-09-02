import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { removeNodeModules, removeBuildArtifacts, gitClean } from '../utils/cleanup-operations';
import { logError, logInfo, logStep, logSuccess } from '../utils/logger';
import { colorize } from '../utils/colors';
import { checkbox, confirm } from '../utils/prompt';
import { getGlobalOpts, resolveWorkspace } from '../utils/command-helpers';

export function registerCleanupCommand(parent: Command) {
  parent
    .command('cleanup')
    .alias('cl')
    .description('Remove node_modules and build artifacts')
    .argument('[workspace]', 'Workspace name')
    .option('--all', 'Clean everything')
    .option('--node-modules', 'Clean node_modules')
    .option('--build', 'Clean build artifacts')
    .option('--git-clean', 'Git clean (remove untracked files)')
    .action(async (workspace, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleCleanup(workspace, { ...opts, ...globalOpts });
    });
}

async function handleCleanup(workspaceArg: string | undefined, opts: {
  all?: boolean;
  nodeModules?: boolean;
  build?: boolean;
  gitClean?: boolean;
  yes: boolean;
  forceRefresh: boolean;
}) {
  try {
    const workspaceName = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    const nodeModules = opts.nodeModules || opts.all;
    const build = opts.build || opts.all;
    const gitCleanFlag = opts.gitClean || opts.all;

    let operations: string[];

    if (nodeModules || build || gitCleanFlag) {
      operations = [];
      if (nodeModules) operations.push('node_modules');
      if (build) operations.push('build');
      if (gitCleanFlag) operations.push('git_clean');
    } else {
      operations = await checkbox({
        message: 'Select cleanup operations:',
        choices: [
          { name: 'Remove node_modules (all repos)', value: 'node_modules' },
          { name: 'Remove build artifacts (dist, build, .next, coverage)', value: 'build' },
          { name: 'Git clean (remove untracked files)', value: 'git_clean' },
        ],
      });
    }

    if (operations.length === 0) {
      logInfo('No operations selected');
      return;
    }

    if (!opts.yes) {
      const confirmed = await confirm({
        message: `Proceed with cleanup? This cannot be undone.`,
        default: false,
      });

      if (!confirmed) {
        logInfo('Cleanup cancelled');
        return;
      }
    }

    logStep('Running cleanup operations...');

    for (const repo of metadata.repositories) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const displayName = repo.directoryName !== repo.name
        ? `${repo.directoryName} (${repo.name})`
        : repo.name;
      console.log(`\n${colorize(displayName, 'cyan')}:`);

      if (operations.includes('node_modules')) {
        const result = await removeNodeModules(repoPath);
        if (result.success) {
          logSuccess(`  Removed node_modules (${result.spaceFreed})`);
        }
      }

      if (operations.includes('build')) {
        const result = await removeBuildArtifacts(repoPath);
        if (result.success && result.filesRemoved > 0) {
          logSuccess(`  Removed ${result.filesRemoved} build artifacts (${result.spaceFreed})`);
        }
      }

      if (operations.includes('git_clean')) {
        const result = await gitClean(repoPath, false);
        if (result.success && result.filesRemoved > 0) {
          logSuccess(`  Git clean: removed ${result.filesRemoved} files`);
        }
      }
    }

    logSuccess('\nCleanup completed!');
  } catch (error) {
    logError('Cleanup failed');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
