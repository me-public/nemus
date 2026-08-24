import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const COMMAND_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface RunResult {
  repo: string;
  status: 'success' | 'failed';
  stdout: string;
  stderr: string;
  error?: string;
}

export async function runInRepo(repoPath: string, repoName: string, command: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: repoPath,
      timeout: COMMAND_TIMEOUT,
    });

    return {
      repo: repoName,
      status: 'success',
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error: any) {
    return {
      repo: repoName,
      status: 'failed',
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || '',
      error: error.message,
    };
  }
}
