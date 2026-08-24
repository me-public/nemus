import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.workspace-manager-cache');
const HISTORY_FILE = path.join(CACHE_DIR, 'history.jsonl');

export interface OperationRecord {
  timestamp: string;
  command: string;
  workspace?: string;
  duration: number;
  success: boolean;
  error?: string;
}

export const ensureCacheDir = async (): Promise<void> => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Ignore if already exists
  }
};

export const logOperation = async (record: OperationRecord): Promise<void> => {
  await ensureCacheDir();

  const line = JSON.stringify(record) + '\n';

  try {
    await fs.appendFile(HISTORY_FILE, line, 'utf-8');
  } catch (error) {
    // Silently fail - don't block operations if logging fails
  }
};

export const readHistory = async (limit?: number): Promise<OperationRecord[]> => {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n');
    const records = lines
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as OperationRecord;
        } catch {
          return null;
        }
      })
      .filter((record): record is OperationRecord => record !== null);

    // Return most recent first
    const reversed = records.reverse();

    return limit ? reversed.slice(0, limit) : reversed;
  } catch {
    return [];
  }
};

export const getOperationStats = async (): Promise<{
  totalOperations: number;
  successRate: number;
  avgDuration: number;
  commandCounts: Record<string, number>;
}> => {
  const history = await readHistory();

  if (history.length === 0) {
    return {
      totalOperations: 0,
      successRate: 0,
      avgDuration: 0,
      commandCounts: {},
    };
  }

  const successful = history.filter(r => r.success).length;
  const totalDuration = history.reduce((sum, r) => sum + r.duration, 0);
  const commandCounts: Record<string, number> = {};

  for (const record of history) {
    commandCounts[record.command] = (commandCounts[record.command] || 0) + 1;
  }

  return {
    totalOperations: history.length,
    successRate: (successful / history.length) * 100,
    avgDuration: totalDuration / history.length,
    commandCounts,
  };
};

export const filterHistory = async (
  command?: string,
  workspace?: string,
  successOnly?: boolean
): Promise<OperationRecord[]> => {
  const history = await readHistory();

  return history.filter(record => {
    if (command && record.command !== command) return false;
    if (workspace && record.workspace !== workspace) return false;
    if (successOnly && !record.success) return false;
    return true;
  });
};

export const clearHistory = async (): Promise<void> => {
  try {
    await fs.unlink(HISTORY_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
};

export class OperationTimer {
  private startTime: number;
  private command: string;
  private workspace?: string;

  constructor(command: string, workspace?: string) {
    this.command = command;
    this.workspace = workspace;
    this.startTime = Date.now();
  }

  async end(success: boolean, error?: string): Promise<void> {
    const duration = Date.now() - this.startTime;

    await logOperation({
      timestamp: new Date().toISOString(),
      command: this.command,
      workspace: this.workspace,
      duration,
      success,
      error,
    });
  }
}
