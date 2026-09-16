import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { resolveWorkspace, getGlobalOpts } from '../utils/command-helpers';
import { buildLock, serializeLock, writeLock, LOCK_FILENAME } from '../utils/workspace-lock';
import { logError, logInfo, logSuccess } from '../utils/logger';
import { colorize } from '../utils/colors';

export function registerLockCommand(parent: Command) {
  parent
    .command('lock [workspace]')
    .description('Snapshot a workspace into a committable nemus.lock (repos + branches)')
    .option('-o, --output <file>', 'Write the lockfile to <file> ("-" for stdout) instead of the workspace root')
    .action(async (workspace, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleLock({ workspace, ...opts, ...globalOpts });
    });
}

async function handleLock(opts: { workspace?: string; output?: string; json?: boolean }) {
  try {
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    const lock = await buildLock(workspacePath, metadata);

    // stdout: emit only the lockfile JSON so it can be piped/redirected cleanly.
    if (opts.output === '-' || opts.json) {
      process.stdout.write(serializeLock(lock));
      return;
    }

    const outPath = opts.output
      ? path.resolve(opts.output)
      : path.join(workspacePath, LOCK_FILENAME);
    await writeLock(outPath, lock);

    logSuccess(`Wrote ${colorize(LOCK_FILENAME, 'cyan')} (${lock.repositories.length} repos) → ${outPath}`);
    logInfo('Commit or share it, then recreate the workspace with: nemus restore');
  } catch (error) {
    logError(error instanceof Error ? error.message : 'Failed to write lockfile');
    process.exit(1);
  }
}
