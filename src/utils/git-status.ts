import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { GitStatus } from '../types';

const execAsync = promisify(exec);
const GIT_TIMEOUT = 10000; // 10 seconds per git operation

export const getGitStatus = async (repoPath: string, repoName: string): Promise<GitStatus> => {
  try {
    const results = await Promise.allSettled([
      getCurrentBranch(repoPath),
      getUncommittedChanges(repoPath),
      getAheadBehindCounts(repoPath),
    ]);

    const branch = results[0].status === 'fulfilled' ? results[0].value : 'unknown';
    const changes = results[1].status === 'fulfilled' ? results[1].value : { clean: false, modifiedFiles: 0, untrackedFiles: 0 };
    const tracking = results[2].status === 'fulfilled' ? results[2].value : { ahead: 0, behind: 0, hasRemote: false };

    return {
      repo: repoName,
      branch,
      clean: changes.clean,
      ahead: tracking.ahead,
      behind: tracking.behind,
      modifiedFiles: changes.modifiedFiles,
      untrackedFiles: changes.untrackedFiles,
      hasRemote: tracking.hasRemote,
      detachedHead: branch.startsWith('HEAD detached'),
    };
  } catch (error) {
    // Return error state
    return {
      repo: repoName,
      branch: 'unknown',
      clean: false,
      ahead: 0,
      behind: 0,
      modifiedFiles: 0,
      untrackedFiles: 0,
      hasRemote: false,
      detachedHead: false,
    };
  }
};

export const getCurrentBranch = async (repoPath: string): Promise<string> => {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });
    const branch = stdout.trim();

    // Check for detached HEAD
    if (branch === 'HEAD') {
      const { stdout: commitHash } = await execAsync('git rev-parse --short HEAD', {
        cwd: repoPath,
        timeout: GIT_TIMEOUT,
      });
      return `HEAD detached at ${commitHash.trim()}`;
    }

    return branch;
  } catch (error) {
    return 'unknown';
  }
};

export const getUncommittedChanges = async (
  repoPath: string
): Promise<{ clean: boolean; modifiedFiles: number; untrackedFiles: number }> => {
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    if (!stdout.trim()) {
      return { clean: true, modifiedFiles: 0, untrackedFiles: 0 };
    }

    const lines = stdout.trim().split('\n');
    let modifiedFiles = 0;
    let untrackedFiles = 0;

    for (const line of lines) {
      const status = line.substring(0, 2);
      if (status.includes('?')) {
        untrackedFiles++;
      } else {
        modifiedFiles++;
      }
    }

    return { clean: false, modifiedFiles, untrackedFiles };
  } catch (error) {
    return { clean: false, modifiedFiles: 0, untrackedFiles: 0 };
  }
};

export const getAheadBehindCounts = async (
  repoPath: string
): Promise<{ ahead: number; behind: number; hasRemote: boolean }> => {
  try {
    // First check if there's a remote tracking branch
    const { stdout: upstreamBranch } = await execAsync('git rev-parse --abbrev-ref @{upstream}', {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    if (!upstreamBranch.trim()) {
      return { ahead: 0, behind: 0, hasRemote: false };
    }

    // Get ahead/behind counts
    const { stdout } = await execAsync('git rev-list --count --left-right @{upstream}...HEAD', {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    const counts = stdout.trim().split('\t');
    const behind = parseInt(counts[0], 10) || 0;
    const ahead = parseInt(counts[1], 10) || 0;

    return { ahead, behind, hasRemote: true };
  } catch (error) {
    // No remote tracking branch
    return { ahead: 0, behind: 0, hasRemote: false };
  }
};

export const getAllReposStatus = async (
  workspacePath: string,
  repoNames: string[],
  concurrency: number = 3
): Promise<GitStatus[]> => {
  const results: GitStatus[] = [];

  // Process in chunks for controlled parallelism
  for (let i = 0; i < repoNames.length; i += concurrency) {
    const chunk = repoNames.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(repoName => {
        const repoPath = path.join(workspacePath, repoName);
        return getGitStatus(repoPath, repoName);
      })
    );
    results.push(...chunkResults);
  }

  return results;
};

export const hasUncommittedChanges = async (repoPath: string): Promise<boolean> => {
  const { clean } = await getUncommittedChanges(repoPath);
  return !clean;
};

export const isGitRepository = async (repoPath: string): Promise<boolean> => {
  try {
    await execAsync('git rev-parse --git-dir', {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });
    return true;
  } catch (error) {
    return false;
  }
};
