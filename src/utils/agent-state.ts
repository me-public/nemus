import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentState, DASHBOARD_DEFAULTS } from '../types/dashboard';

export const AGENTS_STATE_DIR = path.join(os.homedir(), '.nemus', 'agents');

export function ensureStateDir(): void {
  fs.mkdirSync(AGENTS_STATE_DIR, { recursive: true });
}

/**
 * Validate that a session ID is safe to use as a filename.
 * Allows only alphanumeric characters and hyphens, max 100 chars.
 */
function isValidSessionId(id: string): boolean {
  return typeof id === 'string' && /^[a-zA-Z0-9\-]{1,100}$/.test(id);
}

/**
 * Write agent state atomically (write tmp + rename).
 */
export function writeAgentState(state: AgentState): void {
  if (!isValidSessionId(state.sessionId)) return; // reject invalid IDs silently
  ensureStateDir();
  const filePath = path.join(AGENTS_STATE_DIR, `${state.sessionId}.json`);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Clean up tmp on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Read a single agent state by session ID.
 */
export function readAgentState(sessionId: string): AgentState | null {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const filePath = path.join(AGENTS_STATE_DIR, `${sessionId}.json`);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as AgentState;
  } catch {
    return null;
  }
}

/**
 * Check if a process is alive by sending signal 0.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all agent states, check PID liveness, and clean stale entries.
 * Returns active states sorted by workspace, then startedAt.
 */
export function readAllAgentStates(): AgentState[] {
  ensureStateDir();

  let entries: string[];
  try {
    entries = fs.readdirSync(AGENTS_STATE_DIR);
  } catch {
    return [];
  }

  const now = Date.now();
  const states: AgentState[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.startsWith('.')) continue;

    const sessionId = entry.replace('.json', '');
    const state = readAgentState(sessionId);
    if (!state) {
      // Malformed file — remove it
      try { fs.unlinkSync(path.join(AGENTS_STATE_DIR, entry)); } catch { /* ignore */ }
      continue;
    }

    // PID liveness check for non-stopped states
    // Skip the check if the state was updated very recently (within 10s)
    // to allow hooks time to update the PID on session resume
    if (state.status !== 'stopped' && state.pid > 0) {
      const age = now - new Date(state.lastUpdatedAt).getTime();
      if (age > 10_000 && !isProcessAlive(state.pid)) {
        state.status = 'stopped';
        state.lastUpdatedAt = new Date().toISOString();
        writeAgentState(state);
      }
    }

    // Filter out stale stopped states
    if (state.status === 'stopped') {
      const age = now - new Date(state.lastUpdatedAt).getTime();
      if (age > DASHBOARD_DEFAULTS.staleTtlMs) {
        try { fs.unlinkSync(path.join(AGENTS_STATE_DIR, entry)); } catch { /* ignore */ }
        continue;
      }
    }

    states.push(state);
  }

  // Sort by workspace ascending, then startedAt ascending
  states.sort((a, b) => {
    const wsCmp = a.workspace.localeCompare(b.workspace);
    if (wsCmp !== 0) return wsCmp;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  return states;
}

/**
 * Remove a single agent state file.
 */
export function removeAgentState(sessionId: string): void {
  if (!isValidSessionId(sessionId)) return;
  try {
    fs.unlinkSync(path.join(AGENTS_STATE_DIR, `${sessionId}.json`));
  } catch {
    // File doesn't exist — fine
  }
}
