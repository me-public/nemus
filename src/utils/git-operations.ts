import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitHubRepo, CloneResult } from '../types';
import { logSuccess, logError, logInfo, logWarning } from './logger';
import { colorize } from './colors';
import { cloneWithGhq, isGhqInstalled, describeCloneError } from './ghq-integration';
import { withRetry } from './retry';
import { createSimpleProgressBar } from './progress';
import { getCloneUrl, CLONE_TIMEOUT_MS, CLONE_MAX_BUFFER } from './config';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CONCURRENCY_LIMIT = 3;
const CLONE_TIMEOUT = CLONE_TIMEOUT_MS;

export const cloneSingleRepo = async (
  repo: GitHubRepo,
  workspacePath: string,
  directoryName: string,
  useGhq: boolean = true,
  silent: boolean = false
): Promise<CloneResult> => {
  const repoPath = path.join(workspacePath, directoryName);
  const cloneUrl = getCloneUrl(repo);
  const displayName = directoryName !== repo.name
    ? `${colorize(directoryName, 'cyan')} (${repo.name})`
    : colorize(repo.name, 'cyan');

  try {
    if (!silent) logInfo(`Cloning ${displayName}...`);

    await withRetry(async () => {
      // Clean up partial clone before retry
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      if (useGhq) {
        const result = await cloneWithGhq(cloneUrl, repoPath);
        if (!result.success) {
          throw new Error(result.error || 'Clone failed');
        }
        if (!silent) {
          if (result.usedGhq) {
            logSuccess(`Cloned ${displayName} ${colorize('(via ghq)', 'gray')}`);
          } else {
            logSuccess(`Cloned ${displayName}`);
          }
        }
      } else {
        try {
          // execFile (no shell) so repo URLs / paths with spaces or shell
          // metacharacters can't break or inject into the command.
          await execFileAsync('git', ['clone', cloneUrl, repoPath], {
            timeout: CLONE_TIMEOUT,
            maxBuffer: CLONE_MAX_BUFFER,
          });
        } catch (err) {
          // execFile loses the reason on timeout/buffer kill — explain it.
          throw new Error(describeCloneError(err, CLONE_TIMEOUT));
        }
        if (!silent) logSuccess(`Cloned ${displayName}`);
      }
    }, undefined, `Clone ${repo.name}`);

    return {
      repo,
      directoryName,
      status: 'success',
      clonedAt: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logError(`Failed to clone ${displayName}: ${errorMessage}`);

    return {
      repo,
      directoryName,
      status: 'failed',
      error: errorMessage,
    };
  }
};

async function cloneLocal(
  repo: GitHubRepo,
  sourcePath: string,
  workspacePath: string,
  directoryName: string
): Promise<CloneResult> {
  const targetPath = path.join(workspacePath, directoryName);
  try {
    // git clone --local creates hardlinks for .git/objects — nearly instant
    await execAsync(`git clone --local "${sourcePath}" "${targetPath}"`, {
      timeout: CLONE_TIMEOUT,
      maxBuffer: CLONE_MAX_BUFFER,
    });
    // Reset the remote to point to the original repo (not the local source)
    const remoteUrl = getCloneUrl(repo);
    await execAsync(`git remote set-url origin "${remoteUrl}"`, {
      cwd: targetPath,
    });
    return {
      repo,
      directoryName,
      status: 'success',
      clonedAt: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      repo,
      directoryName,
      status: 'failed',
      error: errorMessage,
    };
  }
}

export const cloneRepositories = async (
  repoEntries: Array<{ repo: GitHubRepo; directoryName: string }>,
  workspacePath: string
): Promise<CloneResult[]> => {
  // Check if ghq is available
  const hasGhq = await isGhqInstalled();

  console.log('\n' + '='.repeat(60));
  console.log(`Cloning ${repoEntries.length} repositories (${CONCURRENCY_LIMIT} concurrent clones)`);
  if (hasGhq) {
    console.log(colorize('Using ghq for efficient repository management', 'cyan'));
  }
  console.log('='.repeat(60) + '\n');

  const bar = createSimpleProgressBar(repoEntries.length, 'Cloning');
  bar.start(repoEntries.length, 0);

  // Group entries by repo SSH URL to avoid duplicate clones
  const repoGroups = new Map<string, Array<{ repo: GitHubRepo; directoryName: string }>>();
  for (const entry of repoEntries) {
    const key = entry.repo.sshUrl;
    if (!repoGroups.has(key)) {
      repoGroups.set(key, []);
    }
    repoGroups.get(key)!.push(entry);
  }

  const allResults: CloneResult[] = [];
  let completed = 0;

  // Process unique repo groups with concurrency (different repos clone in parallel)
  const groups = Array.from(repoGroups.values());
  for (let i = 0; i < groups.length; i += CONCURRENCY_LIMIT) {
    const chunk = groups.slice(i, i + CONCURRENCY_LIMIT);
    const chunkPromises = chunk.map(async (entries) => {
      const groupResults: CloneResult[] = [];

      // Clone first instance normally
      const first = entries[0];
      const firstResult = await cloneSingleRepo(
        first.repo, workspacePath, first.directoryName, hasGhq, true
      );
      groupResults.push(firstResult);
      completed++;
      bar.update(completed);

      // Clone remaining instances via --local from the first
      if (firstResult.status === 'success' && entries.length > 1) {
        const sourcePath = path.join(workspacePath, first.directoryName);
        for (const entry of entries.slice(1)) {
          const result = await cloneLocal(
            entry.repo, sourcePath, workspacePath, entry.directoryName
          );
          groupResults.push(result);
          completed++;
          bar.update(completed);
        }
      } else if (firstResult.status === 'failed' && entries.length > 1) {
        // Mark remaining as failed too
        for (const entry of entries.slice(1)) {
          groupResults.push({
            repo: entry.repo,
            directoryName: entry.directoryName,
            status: 'failed',
            error: 'Primary clone failed',
          });
          completed++;
          bar.update(completed);
        }
      }

      return groupResults;
    });

    const chunkResults = await Promise.all(chunkPromises);
    for (const groupResults of chunkResults) {
      allResults.push(...groupResults);
    }
  }

  bar.stop();
  console.log('');

  return allResults;
};

export const reportCloneResults = (results: CloneResult[]): void => {
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');

  console.log('\n' + '='.repeat(60));
  console.log('Clone Results Summary');
  console.log('='.repeat(60));
  console.log(`${colorize('✓', 'green')} Successful: ${successful.length}`);
  console.log(`${colorize('✗', 'red')} Failed: ${failed.length}`);
  console.log('='.repeat(60));

  if (failed.length > 0) {
    console.log('\nFailed repositories:');
    failed.forEach(result => {
      const displayName = result.directoryName !== result.repo.name
        ? `${result.directoryName} (${result.repo.name})`
        : result.repo.name;
      console.log(`  ${colorize('✗', 'red')} ${displayName}: ${result.error}`);
    });
  }

  console.log('');
};
