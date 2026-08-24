import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export interface DiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

export interface RepoDiff {
  repo: string;
  staged: DiffStats;
  unstaged: DiffStats;
  error?: string;
}

export function parseDiffStat(output: string): DiffStats {
  const match = output.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  if (!match) {
    return { files: 0, insertions: 0, deletions: 0 };
  }
  return {
    files: parseInt(match[1], 10) || 0,
    insertions: parseInt(match[2], 10) || 0,
    deletions: parseInt(match[3], 10) || 0,
  };
}

export async function getRepoDiff(repoPath: string, repoName: string): Promise<RepoDiff> {
  try {
    await fs.access(repoPath);
  } catch {
    return { repo: repoName, staged: { files: 0, insertions: 0, deletions: 0 }, unstaged: { files: 0, insertions: 0, deletions: 0 }, error: 'Directory not found' };
  }

  try {
    const [unstagedResult, stagedResult] = await Promise.all([
      execAsync('git diff --stat', { cwd: repoPath }).catch(() => ({ stdout: '' })),
      execAsync('git diff --cached --stat', { cwd: repoPath }).catch(() => ({ stdout: '' })),
    ]);

    return {
      repo: repoName,
      unstaged: parseDiffStat((unstagedResult as { stdout: string }).stdout),
      staged: parseDiffStat((stagedResult as { stdout: string }).stdout),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      repo: repoName,
      staged: { files: 0, insertions: 0, deletions: 0 },
      unstaged: { files: 0, insertions: 0, deletions: 0 },
      error: errorMessage,
    };
  }
}
