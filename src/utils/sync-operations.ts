import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { logInfo, logSuccess, logError } from './logger';
import { colorize } from './colors';
import { withRetry } from './retry';

const execAsync = promisify(exec);

export interface SyncResult {
  repo: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
}

export async function syncRepository(repoPath: string, repoName: string, silent: boolean = false): Promise<SyncResult> {
  try {
    // Check if directory exists
    try {
      await fs.access(repoPath);
    } catch {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Directory not found',
      };
    }

    // Check if it's a git repository
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repoPath });
    } catch {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Not a git repository',
      };
    }

    // Check for uncommitted changes
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath });
    if (statusOutput.trim().length > 0) {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Uncommitted changes',
      };
    }

    // Get current branch
    const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repoPath });
    const currentBranch = branchOutput.trim();

    if (!currentBranch) {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Detached HEAD state',
      };
    }

    if (!silent) logInfo(`Pulling ${colorize(repoName, 'cyan')} (${currentBranch})...`);

    // Git pull with retry
    await withRetry(
      () => execAsync('git pull', { cwd: repoPath, timeout: 60000 }),
      undefined,
      `Pull ${repoName}`
    );

    if (!silent) logSuccess(`Updated ${colorize(repoName, 'cyan')}`);

    return {
      repo: repoName,
      status: 'success',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logError(`Failed to sync ${colorize(repoName, 'cyan')}: ${errorMessage}`);

    return {
      repo: repoName,
      status: 'failed',
      message: errorMessage,
    };
  }
}
