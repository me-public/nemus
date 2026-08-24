import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { hasUncommittedChanges } from './git-status';

const execAsync = promisify(exec);
const GIT_TIMEOUT = 30000;

export interface BranchSwitchResult {
  repo: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
  previousBranch?: string;
  newBranch?: string;
}

export const switchBranch = async (
  repoPath: string,
  repoName: string,
  targetBranch: string
): Promise<BranchSwitchResult> => {
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

    // Get current branch
    const { stdout: currentBranchOutput } = await execAsync('git branch --show-current', { cwd: repoPath });
    const currentBranch = currentBranchOutput.trim();

    if (currentBranch === targetBranch) {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Already on target branch',
        previousBranch: currentBranch,
      };
    }

    // Check for uncommitted changes
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoPath });
    if (statusOutput.trim().length > 0) {
      return {
        repo: repoName,
        status: 'skipped',
        message: 'Uncommitted changes',
        previousBranch: currentBranch,
      };
    }

    // Fetch to ensure we have latest branches
    await execAsync('git fetch', { cwd: repoPath, timeout: GIT_TIMEOUT });

    // Check if branch exists locally
    try {
      await execAsync(`git rev-parse --verify ${targetBranch}`, { cwd: repoPath });
    } catch {
      // Branch doesn't exist locally, check remote
      try {
        await execAsync(`git rev-parse --verify origin/${targetBranch}`, { cwd: repoPath });
        // Branch exists on remote, create local tracking branch
        await execAsync(`git checkout -b ${targetBranch} origin/${targetBranch}`, { cwd: repoPath });
        return {
          repo: repoName,
          status: 'success',
          previousBranch: currentBranch,
          newBranch: targetBranch,
        };
      } catch {
        return {
          repo: repoName,
          status: 'failed',
          message: `Branch ${targetBranch} not found`,
          previousBranch: currentBranch,
        };
      }
    }

    // Switch to existing local branch
    await execAsync(`git checkout ${targetBranch}`, { cwd: repoPath });

    return {
      repo: repoName,
      status: 'success',
      previousBranch: currentBranch,
      newBranch: targetBranch,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      repo: repoName,
      status: 'failed',
      message: errorMessage,
    };
  }
};

export interface BranchOperationResult {
  repo: string;
  success: boolean;
  message: string;
  error?: string;
}

export const createBranch = async (
  repoPath: string,
  repoName: string,
  branchName: string,
  baseBranch?: string,
  force?: boolean
): Promise<BranchOperationResult> => {
  try {
    // Check for uncommitted changes
    if (!force) {
      const hasChanges = await hasUncommittedChanges(repoPath);
      if (hasChanges) {
        return {
          repo: repoName,
          success: false,
          message: 'Skipped (uncommitted changes)',
        };
      }
    }

    // Checkout base branch if specified
    if (baseBranch) {
      await execAsync(`git checkout ${baseBranch}`, {
        cwd: repoPath,
        timeout: GIT_TIMEOUT,
      });
    }

    // Create and checkout new branch
    await execAsync(`git checkout -b ${branchName}`, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    return {
      repo: repoName,
      success: true,
      message: `Created branch ${branchName}`,
    };
  } catch (error) {
    return {
      repo: repoName,
      success: false,
      message: 'Failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export const mergeBranch = async (
  repoPath: string,
  repoName: string,
  sourceBranch: string,
  targetBranch: string,
  options?: { noFf?: boolean; ffOnly?: boolean; squash?: boolean }
): Promise<BranchOperationResult> => {
  try {
    // Checkout target branch
    await execAsync(`git checkout ${targetBranch}`, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    // Build merge command
    let mergeCmd = `git merge ${sourceBranch}`;
    if (options?.noFf) mergeCmd += ' --no-ff';
    if (options?.ffOnly) mergeCmd += ' --ff-only';
    if (options?.squash) mergeCmd += ' --squash';

    await execAsync(mergeCmd, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    return {
      repo: repoName,
      success: true,
      message: `Merged ${sourceBranch} into ${targetBranch}`,
    };
  } catch (error) {
    return {
      repo: repoName,
      success: false,
      message: 'Merge failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

export const rebaseBranch = async (
  repoPath: string,
  repoName: string,
  targetBranch: string
): Promise<BranchOperationResult> => {
  try {
    await execAsync(`git rebase ${targetBranch}`, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });

    return {
      repo: repoName,
      success: true,
      message: `Rebased onto ${targetBranch}`,
    };
  } catch (error) {
    return {
      repo: repoName,
      success: false,
      message: 'Rebase failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
