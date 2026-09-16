import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata, listWorkspaces } from '../utils/workspace-meta';
import { resolveWorkspace, getGlobalOpts } from '../utils/command-helpers';
import { buildLock, serializeLock, writeLock, LOCK_FILENAME } from '../utils/workspace-lock';
import { logError, logInfo, logSuccess, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';

export function registerLockCommand(parent: Command) {
  parent
    .command('lock [workspace]')
    .description('Snapshot a workspace into a committable nemus.lock (repos + branches)')
    .option('-o, --output <file>', 'Write the lockfile to <file> ("-" for stdout) instead of the workspace root')
    .option('--all', 'Write a nemus.lock into every workspace (skips ones that already have one)')
    .option('--force', 'With --all, overwrite an existing nemus.lock')
    .action(async (workspace, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleLock({ workspace, ...opts, ...globalOpts });
    });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function handleLock(opts: {
  workspace?: string;
  output?: string;
  all?: boolean;
  force?: boolean;
}) {
  if (opts.all) {
    await handleLockAll(opts);
    return;
  }

  try {
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    const lock = await buildLock(workspacePath, metadata);

    // `-o -`: emit only the lockfile JSON so it can be piped/redirected cleanly.
    if (opts.output === '-') {
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

/**
 * Bulk mode: drop a nemus.lock into every workspace so a whole machine's
 * workspaces become portable in one shot. Existing lockfiles are left alone
 * (they may be hand-edited / committed) unless --force is given — this is the
 * explicit, discoverable alternative to burying a snapshot side effect inside
 * `migrate`, which is meant to be re-run freely.
 */
async function handleLockAll(opts: { output?: string; force?: boolean }) {
  if (opts.output) {
    logError('--all writes one nemus.lock per workspace and cannot be combined with --output.');
    process.exit(1);
  }

  const workspaces = await listWorkspaces(false);
  if (workspaces.length === 0) {
    logInfo('No workspaces found. Nothing to lock.');
    return;
  }

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const ws of workspaces) {
    const metadata = ws.metadata ?? (await loadMetadata(ws.path));
    if (!metadata) {
      logWarning(`  ${ws.name}: no metadata — skipped (run 'nemus migrate' first)`);
      skipped++;
      continue;
    }

    const outPath = path.join(ws.path, LOCK_FILENAME);
    if (!opts.force && (await fileExists(outPath))) {
      logInfo(`  ${colorize(ws.name, 'cyan')}: ${LOCK_FILENAME} already exists — skipped (use --force to overwrite)`);
      skipped++;
      continue;
    }

    try {
      const lock = await buildLock(ws.path, metadata);
      await writeLock(outPath, lock);
      logSuccess(`  ${colorize(ws.name, 'cyan')}: wrote ${LOCK_FILENAME} (${lock.repositories.length} repos)`);
      written++;
    } catch (error) {
      logError(`  ${ws.name}: ${error instanceof Error ? error.message : 'failed to write lockfile'}`);
      errors++;
    }
  }

  console.log('');
  logInfo('Bulk lock complete:');
  console.log(`  ${colorize(String(written), 'green')} written`);
  if (skipped > 0) console.log(`  ${colorize(String(skipped), 'yellow')} skipped`);
  if (errors > 0) console.log(`  ${colorize(String(errors), 'red')} errors`);
}
