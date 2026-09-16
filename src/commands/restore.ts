import { Command } from 'commander';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { getGlobalOpts } from '../utils/command-helpers';
import { readLockFile, parseLock, reconstructRepo, LOCK_FILENAME, type WorkspaceLock, type LockRepo } from '../utils/workspace-lock';
import { cloneRepositories, reportCloneResults } from '../utils/git-operations';
import { warnIfGhqMissing } from '../utils/ghq-integration';
import { createMetadata, saveMetadata } from '../utils/workspace-meta';
import { generateClaudeContext } from '../utils/claude-integration';
import { verifyGhAuth } from '../utils/github';
import { validateWorkspaceName, checkWorkspaceExists, sanitizeWorkspaceName, resolveWorkspaceNameConflict } from '../utils/validation';
import { logError, logInfo, logSuccess, logStep, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { printBanner } from '../utils/banner';
import type { CloneResult } from '../types';

export interface RestoreResult {
  workspaceName: string;
  workspacePath: string;
  results: CloneResult[];
}

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT = 30000;

export function registerRestoreCommand(parent: Command) {
  parent
    .command('restore [lockfile]')
    .description('Recreate a workspace from a nemus.lock (defaults to ./nemus.lock, "-" for stdin)')
    .option('-w, --workspace <name>', 'Override the workspace name baked into the lockfile')
    .option('--pin', 'Check out the exact recorded commit instead of the branch tip')
    .action(async (lockfile, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleRestore({ lockfile, ...opts, ...globalOpts });
    });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

// `branch`/`commit` come from an untrusted lockfile (already ref-validated in
// parseLock); the `--end-of-options` guard is defense-in-depth so a ref can
// never be reparsed as a git option even if validation is bypassed.
/** Check out `branch` in a freshly-cloned repo, creating a tracking branch if needed. */
async function checkoutBranch(repoPath: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['checkout', '--end-of-options', branch], { cwd: repoPath, timeout: GIT_TIMEOUT });
    return true;
  } catch {
    try {
      await execFileAsync('git', ['checkout', '-b', branch, '--end-of-options', `origin/${branch}`], { cwd: repoPath, timeout: GIT_TIMEOUT });
      return true;
    } catch {
      return false;
    }
  }
}

async function checkoutCommit(repoPath: string, commit: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['checkout', '--end-of-options', commit], { cwd: repoPath, timeout: GIT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Core restore: clone every repo in a (already-validated) lock and check out the
 * recorded branch (or the exact commit with `pin`), then write metadata + agent
 * context — exactly like `create`. Throws on fatal errors (no process.exit) and
 * logs progress via the logger (stderr), so both the CLI and the MCP tool can
 * call it. Callers own presentation (final message, shell-CD hook).
 */
export async function restoreWorkspace(
  lock: WorkspaceLock,
  opts: { workspace?: string; pin?: boolean } = {}
): Promise<RestoreResult> {
  if (lock.repositories.length === 0) {
    throw new Error('Lockfile has no repositories to restore');
  }

  // Resolve the target workspace name
  let workspaceName = sanitizeWorkspaceName(opts.workspace || lock.workspace);
  const nameError = validateWorkspaceName(workspaceName);
  if (nameError !== true) {
    throw new Error(typeof nameError === 'string' ? nameError : 'Invalid workspace name');
  }
  if (await checkWorkspaceExists(workspaceName)) {
    const resolved = await resolveWorkspaceNameConflict(
      workspaceName,
      lock.repositories.map(r => r.directoryName)
    );
    logInfo(`Workspace "${workspaceName}" already exists — using "${colorize(resolved, 'cyan')}" instead.`);
    workspaceName = resolved;
  }

  const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
  logInfo(`Restoring ${colorize(String(lock.repositories.length), 'cyan')} repos into workspace "${colorize(workspaceName, 'cyan')}"`);

  // Clone every repo (reuses the create pipeline: ghq, concurrency, dedup)
  logStep(1, 3, 'Cloning repositories...');
  const { mkdir } = await import('fs/promises');
  await mkdir(workspacePath, { recursive: true });
  await warnIfGhqMissing();

  const entries = lock.repositories.map(r => ({
    repo: reconstructRepo(r),
    directoryName: r.directoryName,
  }));
  const results = await cloneRepositories(entries, workspacePath);
  reportCloneResults(results);

  // Check out the recorded branch (or pinned commit) per repo
  logStep(2, 3, opts.pin ? 'Checking out pinned commits...' : 'Checking out recorded branches...');
  const byDir = new Map<string, LockRepo>(lock.repositories.map(r => [r.directoryName, r]));
  for (const result of results) {
    if (result.status !== 'success') continue;
    const entry = byDir.get(result.directoryName);
    if (!entry) continue;
    const repoPath = path.join(workspacePath, result.directoryName);
    const display = colorize(result.directoryName, 'cyan');

    if (opts.pin && entry.commit) {
      if (!(await checkoutCommit(repoPath, entry.commit))) {
        logWarning(`${display}: could not check out pinned commit ${entry.commit} — left on the default branch`);
      }
    } else if (entry.branch) {
      if (await checkoutBranch(repoPath, entry.branch)) {
        logInfo(`${display} → ${entry.branch}`);
      } else if (entry.commit && (await checkoutCommit(repoPath, entry.commit))) {
        logWarning(`${display}: branch "${entry.branch}" not found — checked out commit ${entry.commit} instead`);
      } else {
        logWarning(`${display}: could not check out "${entry.branch}" — left on the default branch`);
      }
    }
  }

  // Metadata + agent context (same as create)
  logStep(3, 3, 'Saving workspace metadata...');
  const metadata = createMetadata(workspaceName, results, { prompt: `Restored from ${LOCK_FILENAME}` });
  await saveMetadata(workspacePath, metadata);

  const successfulRepos = results.filter(r => r.status === 'success').map(r => r.repo);
  if (successfulRepos.length > 0) {
    await generateClaudeContext(workspacePath, workspaceName, successfulRepos, metadata);
  }

  return { workspaceName, workspacePath, results };
}

async function handleRestore(opts: {
  lockfile?: string;
  workspace?: string;
  pin?: boolean;
  yes: boolean;
}) {
  printBanner();

  try {
    // Step 1: Load + validate the lockfile
    let lock: WorkspaceLock;
    if (opts.lockfile === '-') {
      lock = parseLock(await readStdin());
    } else {
      const lockPath = path.resolve(opts.lockfile || LOCK_FILENAME);
      try {
        lock = await readLockFile(lockPath);
      } catch (error) {
        logError(`Could not read lockfile at ${lockPath}`);
        if (error instanceof Error) logError(error.message);
        logInfo('Pass a path (nemus restore path/to/nemus.lock) or pipe one with: nemus restore -');
        process.exit(1);
      }
    }

    if (lock.repositories.length === 0) {
      logError('Lockfile has no repositories to restore');
      process.exit(1);
    }

    // gh auth (soft — private repos need it, public/other creds may not)
    if (!(await verifyGhAuth())) {
      logWarning('GitHub CLI not authenticated — private repositories may fail to clone.');
    }

    const { workspaceName, workspacePath } = await restoreWorkspace(lock, {
      workspace: opts.workspace,
      pin: opts.pin,
    });

    logSuccess(`Workspace "${colorize(workspaceName, 'cyan')}" restored!`);

    // Shell-integration auto-CD (same hook create uses)
    try {
      const { writeFile } = await import('fs/promises');
      const os = await import('os');
      await writeFile(path.join(os.homedir(), '.workspace-last-created'), workspacePath, 'utf-8');
    } catch {
      // non-critical
    }
  } catch (error) {
    logError('Failed to restore workspace');
    if (error instanceof Error) logError(error.message);
    process.exit(1);
  }
}
