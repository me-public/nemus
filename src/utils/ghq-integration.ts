import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logInfo, logSuccess, logWarning } from './logger';
import { colorize } from './colors';
import { CLONE_TIMEOUT_MS, CLONE_MAX_BUFFER } from './config';

const execAsync = promisify(exec);

/**
 * Turn a raw child-process clone failure (from exec or execFile) into an
 * actionable message. The child API discards the reason on timeout/buffer kill (you just get "Command
 * failed: git clone …"), so we inspect killed/signal/code and the captured
 * stderr to explain what actually happened and how to fix it.
 */
export function describeCloneError(error: unknown, timeoutMs: number = CLONE_TIMEOUT_MS): string {
  const e = (error ?? {}) as { message?: string; killed?: boolean; signal?: string; code?: string; stderr?: string };
  const stderr = (e.stderr || '').trim();
  const tail = stderr ? `\n  git: ${stderr.split('\n').filter(Boolean).slice(-3).join(' ')}` : '';

  // Check maxBuffer FIRST: Node sets killed=true on a maxBuffer kill too, so
  // the timeout heuristic below would otherwise shadow this case.
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return `Clone output exceeded the buffer limit (very large repo). Install ghq (brew install ghq) for cached clones.${tail}`;
  }

  const timedOut = e.killed === true || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
  if (timedOut) {
    const mins = Math.round(timeoutMs / 60000);
    return `Clone timed out after ${mins} min — the repo may be large or the network slow. `
      + `Fixes: install ghq for fast cached clones (brew install ghq), switch to SSH (w configure), `
      + `or raise the limit with WORKSPACE_CLONE_TIMEOUT_MS.${tail}`;
  }
  return `${e.message || 'Unknown error'}${tail}`;
}

/**
 * Check if ghq is installed
 */
export async function isGhqInstalled(): Promise<boolean> {
  try {
    await execAsync('which ghq');
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify ghq is installed and, if not, warn with install guidance.
 * ghq gives fast cached clones (shared across workspaces) and avoids the
 * clone-timeout failures large repos hit over plain git-over-HTTPS.
 * Returns true if ghq is available. Non-blocking — clones still work without it.
 */
export async function warnIfGhqMissing(): Promise<boolean> {
  if (await isGhqInstalled()) return true;
  logWarning('ghq is not installed — using direct git clone (slower, no shared cache).');
  logInfo('  ghq caches repos so re-cloning across workspaces is near-instant and large repos avoid clone timeouts.');
  logInfo(`  Install: ${colorize('brew install ghq', 'cyan')}  (macOS)  —  Linux/Windows: https://github.com/x-motemen/ghq#installation`);
  return false;
}

/**
 * Get ghq root directory
 */
export async function getGhqRoot(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('ghq root');
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a repository exists in ghq
 */
export async function ghqRepoExists(repoUrl: string): Promise<boolean> {
  try {
    const repoPath = await getGhqRepoPath(repoUrl);
    if (!repoPath) return false;

    await execAsync(`test -d "${repoPath}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the local path for a ghq-managed repository
 */
export async function getGhqRepoPath(repoUrl: string): Promise<string | null> {
  try {
    // Extract org/repo from URL
    // e.g., git@github.com:my-org/my-app.git -> github.com/my-org/my-app
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^.]+)/);
    if (!match) return null;

    const [, org, repo] = match;
    const ghqRoot = await getGhqRoot();
    if (!ghqRoot) return null;

    return path.join(ghqRoot, 'github.com', org, repo);
  } catch {
    return null;
  }
}

/**
 * Clone repository using ghq
 */
export async function ghqGet(repoUrl: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    logInfo(`Using ghq to clone ${colorize(repoUrl, 'cyan')}...`);

    await execAsync(`ghq get "${repoUrl}"`, { timeout: CLONE_TIMEOUT_MS, maxBuffer: CLONE_MAX_BUFFER });

    const repoPath = await getGhqRepoPath(repoUrl);
    if (!repoPath) {
      return { success: false, error: 'Could not determine ghq path' };
    }

    logSuccess(`Repository available in ghq: ${colorize(repoPath, 'gray')}`);

    return { success: true, path: repoPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * List all repositories managed by ghq
 */
export async function ghqList(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('ghq list');
    return stdout.trim().split('\n').filter(line => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Display ghq installation instructions
 */
export function displayGhqInfo(): void {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('About ghq', 'bright'));
  console.log('='.repeat(60));
  console.log('\nghq is a tool for managing Git repositories in a structured way.');
  console.log('The workspace manager can use ghq for better repository organization.\n');
  console.log('Installation:');
  console.log('  brew install ghq\n');
  console.log('Benefits:');
  console.log('  • Centralized repository cache');
  console.log('  • Consistent directory structure');
  console.log('  • Faster subsequent clones');
  console.log('  • Works alongside workspace isolation\n');
  console.log('After installing ghq, the workspace manager will automatically use it.');
  console.log('='.repeat(60) + '\n');
}

/**
 * Clone repository with ghq integration
 * Falls back to direct git clone if ghq is not available
 */
export async function cloneWithGhq(
  repoUrl: string,
  targetPath: string
): Promise<{ success: boolean; error?: string; usedGhq: boolean }> {
  const hasGhq = await isGhqInstalled();

  if (hasGhq) {
    // Check if repo already exists in ghq cache
    const ghqPath = await getGhqRepoPath(repoUrl);
    let ghqReady = !!(ghqPath && await ghqRepoExists(repoUrl));

    if (!ghqReady) {
      // Not in cache — clone into ghq first (without -u to avoid extra fetch)
      const ghqResult = await ghqGet(repoUrl);
      if (ghqResult.success) {
        ghqReady = true;
      } else {
        logWarning(`ghq clone failed: ${ghqResult.error}`);
      }
    }

    // Use git clone --local from ghq cache (hardlinks .git/objects — nearly instant)
    const sourcePath = ghqPath || (await getGhqRepoPath(repoUrl));
    if (ghqReady && sourcePath) {
      try {
        // Refresh the ghq cache BEFORE clone-local so the workspace gets the
        // latest content. Without this, an old cache (cloned weeks/months ago)
        // would serve stale state via hardlinks — user would open a workspace
        // missing dozens of recent commits.
        try {
          await execAsync(
            `git -C "${sourcePath}" fetch origin --quiet --prune`,
            { timeout: 90 * 1000 },
          );
        } catch {
          // Network failure or no upstream — fall through with stale cache,
          // we'll log a warning after the local clone if we can't align to HEAD.
        }

        await execAsync(`git clone --local "${sourcePath}" "${targetPath}"`, { timeout: 60 * 1000 });
        // Reset remote to point to the original repo URL (not the local ghq path)
        await execAsync(`git remote set-url origin "${repoUrl}"`, { cwd: targetPath });

        // Make sure the working tree is at origin's default-branch tip.
        // Robust against:
        //   - cache having a non-default branch checked out
        //   - fetch above failing (network blip)
        //   - refs/remotes/origin/HEAD symref not being set (some git/ghq combos)
        let alignedToHead = false;
        let alignError: string | null = null;
        try {
          await execAsync(`git fetch origin --quiet`, { cwd: targetPath, timeout: 60 * 1000 });

          // Explicitly set refs/remotes/origin/HEAD by querying the remote.
          // Without this, symbolic-ref may fail if the local symref wasn’t set.
          await execAsync(`git remote set-head origin --auto`, { cwd: targetPath, timeout: 30 * 1000 })
            .catch(() => { /* if this fails the next step might still succeed */ });

          let defaultBranch: string | null = null;
          try {
            const headRes = await execAsync(
              `git symbolic-ref --short refs/remotes/origin/HEAD`,
              { cwd: targetPath, timeout: 5000 },
            );
            defaultBranch = headRes.stdout.trim().replace(/^origin\//, '');
          } catch {
            // Fall back to ls-remote query against the actual remote
            try {
              const lsRes = await execAsync(
                `git ls-remote --symref origin HEAD`,
                { cwd: targetPath, timeout: 30 * 1000 },
              );
              const match = lsRes.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
              if (match) defaultBranch = match[1];
            } catch { /* fall through to common-name fallback */ }
          }

          // Final fallback: try common default branches
          if (!defaultBranch) {
            for (const candidate of ['main', 'master']) {
              const exists = await execAsync(
                `git rev-parse --verify --quiet origin/${candidate}`,
                { cwd: targetPath, timeout: 5000 },
              ).then(() => true).catch(() => false);
              if (exists) { defaultBranch = candidate; break; }
            }
          }

          if (!defaultBranch) {
            throw new Error('could not determine default branch (no origin/HEAD, no main, no master)');
          }

          await execAsync(`git checkout --quiet "${defaultBranch}"`, { cwd: targetPath, timeout: 10 * 1000 });
          await execAsync(`git reset --hard --quiet "origin/${defaultBranch}"`, { cwd: targetPath, timeout: 10 * 1000 });
          alignedToHead = true;
        } catch (error) {
          alignError = error instanceof Error ? error.message : String(error);
        }

        if (!alignedToHead) {
          // LOUD warning — stale content silently is the worst UX. Surface it.
          logWarning(`⚠️  Could not align ${repoUrl} to origin/HEAD — workspace may have stale content!`);
          if (alignError) logWarning(`   reason: ${alignError}`);
          logWarning(`   manual fix: cd into the repo and run 'git pull --ff-only'`);
        }

        return { success: true, usedGhq: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logWarning(`Local clone from ghq failed: ${errorMessage}`);
        // Clean up partial clone before fallback
        try { await execAsync(`rm -rf "${targetPath}"`); } catch { /* ignore */ }
        // Fall through to direct clone
      }
    }
  }

  // Fallback to direct git clone
  try {
    await execAsync(`git clone "${repoUrl}" "${targetPath}"`, { timeout: CLONE_TIMEOUT_MS, maxBuffer: CLONE_MAX_BUFFER });
    return { success: true, usedGhq: false };
  } catch (error) {
    return { success: false, error: describeCloneError(error), usedGhq: false };
  }
}

/**
 * Show ghq status
 */
export async function getGhqStatus(): Promise<{
  installed: boolean;
  root?: string;
  repoCount?: number;
}> {
  const installed = await isGhqInstalled();

  if (!installed) {
    return { installed: false };
  }

  const root = await getGhqRoot();
  const repos = await ghqList();

  return {
    installed: true,
    root: root || undefined,
    repoCount: repos.length,
  };
}
