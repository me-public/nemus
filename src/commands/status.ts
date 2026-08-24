import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { getAllReposStatus } from '../utils/git-status';
import { logError, logInfo, logStep } from '../utils/logger';
import { colorize } from '../utils/colors';
import { resolveWorkspace } from '../utils/command-helpers';

const displayStatusTable = (statuses: Array<{ repo: string; branch: string; clean: boolean; ahead: number; behind: number; modifiedFiles: number; untrackedFiles: number; hasRemote: boolean; detachedHead: boolean }>) => {
  console.log('\n' + colorize('═'.repeat(100), 'gray'));
  console.log(
    colorize('Repo', 'bright').padEnd(30) +
    colorize('Branch', 'bright').padEnd(25) +
    colorize('Status', 'bright').padEnd(15) +
    colorize('Ahead/Behind', 'bright').padEnd(15) +
    colorize('Modified', 'bright')
  );
  console.log(colorize('─'.repeat(100), 'gray'));

  for (const status of statuses) {
    const repoName = status.repo.padEnd(20);
    let branchDisplay = status.branch.padEnd(15);
    if (status.detachedHead) {
      branchDisplay = colorize(branchDisplay, 'yellow');
    }

    let statusDisplay = '';
    if (status.clean) {
      statusDisplay = colorize('✓ Clean', 'green').padEnd(15);
    } else {
      const changes = [];
      if (status.modifiedFiles > 0) changes.push(`${status.modifiedFiles} modified`);
      if (status.untrackedFiles > 0) changes.push(`${status.untrackedFiles} untracked`);
      statusDisplay = colorize(`⚠ ${changes.join(', ')}`, 'yellow').padEnd(15);
    }

    let trackingDisplay = '';
    if (!status.hasRemote) {
      trackingDisplay = colorize('No remote', 'gray').padEnd(15);
    } else if (status.ahead === 0 && status.behind === 0) {
      trackingDisplay = colorize('Up to date', 'green').padEnd(15);
    } else {
      const parts = [];
      if (status.ahead > 0) parts.push(colorize(`↑${status.ahead}`, 'cyan'));
      if (status.behind > 0) parts.push(colorize(`↓${status.behind}`, 'red'));
      trackingDisplay = parts.join(' ').padEnd(15);
    }

    const modifiedDisplay = status.clean ? '-' : `${status.modifiedFiles + status.untrackedFiles} files`;
    console.log(`${repoName} ${branchDisplay} ${statusDisplay} ${trackingDisplay} ${modifiedDisplay}`);
  }

  console.log(colorize('═'.repeat(100), 'gray'));

  const cleanRepos = statuses.filter(s => s.clean).length;
  const dirtyRepos = statuses.filter(s => !s.clean).length;
  const needsPush = statuses.filter(s => s.ahead > 0).length;
  const needsPull = statuses.filter(s => s.behind > 0).length;

  console.log('\n' + colorize('Summary:', 'bright'));
  console.log(`  ${colorize('✓', 'green')} ${cleanRepos} clean repositories`);
  if (dirtyRepos > 0) {
    console.log(`  ${colorize('⚠', 'yellow')} ${dirtyRepos} repositories with uncommitted changes`);
  }
  if (needsPush > 0) {
    console.log(`  ${colorize('↑', 'cyan')} ${needsPush} repositories ahead of remote`);
  }
  if (needsPull > 0) {
    console.log(`  ${colorize('↓', 'red')} ${needsPull} repositories behind remote`);
  }
  console.log('');
};

export function registerStatusCommand(parent: Command) {
  parent
    .command('status')
    .alias('st')
    .description('Show git status across all repos')
    .argument('[workspace]', 'Workspace name')
    .action(async (workspace) => {
      await handleStatus(workspace);
    });
}

async function handleStatus(workspaceArg?: string) {
  try {
    const selectedWorkspace = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, selectedWorkspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace metadata not found for: ${selectedWorkspace}`);
      process.exit(1);
    }

    logStep(`Checking status for workspace: ${colorize(selectedWorkspace, 'cyan')}`);
    logInfo(`Found ${metadata.repositories.length} repositories`);

    const repoDirectoryNames = metadata.repositories.map(r => r.directoryName);
    const statuses = await getAllReposStatus(workspacePath, repoDirectoryNames, 3);

    displayStatusTable(statuses);
  } catch (error) {
    logError('Failed to check workspace status');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
