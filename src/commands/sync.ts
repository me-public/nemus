import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { logInfo, logSuccess, logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { createSimpleProgressBar } from '../utils/progress';
import { syncRepository, SyncResult } from '../utils/sync-operations';
import { resolveWorkspace } from '../utils/command-helpers';

export function registerSyncCommand(parent: Command) {
  parent
    .command('sync')
    .alias('s')
    .description('Git pull all repos in a workspace')
    .argument('[workspace]', 'Workspace name')
    .option('-w, --workspace <name>', 'Workspace name (alternative to positional)')
    .action(async (workspaceArg, opts) => {
      await handleSync(opts.workspace || workspaceArg);
    });
}

async function handleSync(workspaceArg?: string) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Sync Workspace', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const workspaceName = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    logInfo(`Syncing workspace: ${colorize(workspaceName, 'cyan')}`);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      logError('No metadata found for this workspace');
      process.exit(1);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    console.log(`\nFound ${repos.length} repositories to sync\n`);

    const results: SyncResult[] = [];
    const bar = createSimpleProgressBar(repos.length, 'Syncing');
    bar.start(repos.length, 0);

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const displayName = repo.directoryName !== repo.name
        ? `${repo.directoryName} (${repo.name})`
        : repo.name;
      const result = await syncRepository(repoPath, displayName, true);
      results.push(result);
      bar.update(results.length);
    }

    bar.stop();
    console.log('');

    console.log('\n' + '='.repeat(60));
    console.log('Sync Results Summary');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    const skipped = results.filter(r => r.status === 'skipped');

    console.log(`${colorize('✓', 'green')} Updated: ${successful.length}`);
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
    logSuccess('Workspace sync complete!');

  } catch (error) {
    logError('Failed to sync workspace');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
