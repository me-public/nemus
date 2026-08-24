import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { resolveWorkspace } from '../utils/command-helpers';
import { getRepoDiff, RepoDiff } from '../utils/diff-operations';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function registerDiffCommand(parent: Command) {
  parent
    .command('diff')
    .alias('di')
    .description('Show diff summary across all repos')
    .argument('[workspace]', 'Workspace name')
    .option('--full', 'Show full diff output')
    .action(async (workspace, opts) => {
      await handleDiff(workspace, opts);
    });
}

async function handleDiff(workspaceArg?: string, opts: { full?: boolean } = {}) {
  try {
    const selectedWorkspace = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, selectedWorkspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace metadata not found for: ${selectedWorkspace}`);
      process.exit(1);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');

    console.log('\n' + colorize('Workspace Diff Summary', 'bright'));
    console.log(colorize('═'.repeat(40), 'gray') + '\n');

    const diffs: RepoDiff[] = [];
    let totalStaged = 0;
    let totalUnstaged = 0;
    let reposWithChanges = 0;

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const displayName = repo.directoryName !== repo.name
        ? `${repo.directoryName} (${repo.name})`
        : repo.name;

      const diff = await getRepoDiff(repoPath, displayName);
      diffs.push(diff);

      if (diff.error) {
        console.log(colorize(diff.repo, 'cyan'));
        console.log(`  ${colorize('⚠', 'yellow')} ${diff.error}\n`);
        continue;
      }

      const hasChanges = diff.staged.files > 0 || diff.unstaged.files > 0;

      if (hasChanges) {
        reposWithChanges++;
        totalStaged += diff.staged.files;
        totalUnstaged += diff.unstaged.files;

        console.log(colorize(diff.repo, 'cyan'));
        if (diff.staged.files > 0) {
          console.log(`  Staged:   ${diff.staged.files} file(s), ${colorize(`+${diff.staged.insertions}`, 'green')}, ${colorize(`-${diff.staged.deletions}`, 'red')}`);
        }
        if (diff.unstaged.files > 0) {
          console.log(`  Unstaged: ${diff.unstaged.files} file(s), ${colorize(`+${diff.unstaged.insertions}`, 'green')}, ${colorize(`-${diff.unstaged.deletions}`, 'red')}`);
        }
        console.log('');

        if (opts.full) {
          try {
            const { stdout: fullDiff } = await execAsync('git diff', { cwd: path.join(workspacePath, repo.directoryName) });
            if (fullDiff.trim()) {
              console.log(colorize('--- Full diff ---', 'gray'));
              console.log(fullDiff);
              console.log('');
            }
          } catch {
            // Ignore errors getting full diff
          }
        }
      } else {
        console.log(colorize(diff.repo, 'cyan'));
        console.log(`  ${colorize('✓', 'green')} Clean\n`);
      }
    }

    console.log(colorize('═'.repeat(40), 'gray'));
    console.log(`Total: ${colorize(String(totalStaged), 'green')} staged, ${colorize(String(totalUnstaged), 'yellow')} unstaged across ${reposWithChanges} repo(s)`);
    console.log('');
  } catch (error) {
    logError('Failed to get workspace diff');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
