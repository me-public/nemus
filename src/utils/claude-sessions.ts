import * as fs from 'fs/promises';
import * as path from 'path';
import { WORKSPACES_DIR } from './config';
import { getActiveAgents, AgentPaths, ConcreteAgentType } from './agent-config';

export interface WorkspaceSession {
  workspaceName: string;
  workspacePath: string;
  sessionId: string;
  lastActiveAt: Date;
  /** Human-readable relative time, e.g. "2 hours ago" */
  lastActiveLabel: string;
  /** Which agent created this session */
  agentType: ConcreteAgentType;
}

/**
 * Scan session directories for workspace-related session files.
 * Checks Claude (~/.claude/projects/) and/or Pi (~/.pi/agent/sessions/) based on config.
 * Returns sessions sorted by last activity (most recent first).
 *
 * Note: Pi session discovery has limitations. Pi uses a different naming convention
 * (--path--with--dashes--) vs Claude's (-path-with-dashes). This scanner currently
 * only reliably finds Claude sessions. Pi session discovery may require updates
 * based on Pi's actual session directory structure.
 */
export async function getWorkspaceSessions(): Promise<WorkspaceSession[]> {
  const agents = getActiveAgents();
  const allSessions: WorkspaceSession[] = [];

  // Scan each active agent's session directory
  for (const agent of agents) {
    const sessions = await scanProjectsDir(agent.sessionProjectsDir, agent.type);
    allSessions.push(...sessions);
  }

  // Deduplicate by workspace + session ID, sort by most recent
  const seen = new Set<string>();
  const deduped = allSessions.filter(s => {
    const key = `${s.workspacePath}:${s.sessionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  return deduped;
}

/**
 * Scan a single projects/sessions directory for workspace sessions.
 */
async function scanProjectsDir(projectsDir: string, agentType: ConcreteAgentType): Promise<WorkspaceSession[]> {
  // Only Claude Code and Pi expose a scannable per-project session directory
  // layout. OpenCode stores sessions in SQLite; Codex/Gemini use their own
  // formats that aren't scanned here — skip them.
  if (agentType !== 'claude' && agentType !== 'pi') return [];

  const workspacesPrefix = pathToProjectDirName(WORKSPACES_DIR, agentType);

  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  // Filter to only workspace project directories
  const workspaceProjectDirs = projectDirs.filter(dir => {
    if (agentType === 'pi') {
      // Pi dirs: "--{base}-{name}--", so strip trailing -- from prefix to match base + '-'
      const prefixBase = workspacesPrefix.slice(0, -2); // remove trailing --
      return dir.startsWith(prefixBase + '-') && dir !== workspacesPrefix;
    }
    // Claude: prefix + dash separator
    return dir.startsWith(workspacesPrefix + '-') && dir !== workspacesPrefix;
  });

  const sessions: WorkspaceSession[] = [];

  await Promise.all(workspaceProjectDirs.map(async (projDir) => {
    const workspaceName = extractWorkspaceName(projDir, workspacesPrefix, agentType);
    if (!workspaceName) return;

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    // Check workspace still exists on disk
    try {
      await fs.access(workspacePath);
    } catch {
      return; // Workspace deleted, skip
    }

    const fullProjDir = path.join(projectsDir, projDir);
    const session = await getMostRecentSession(fullProjDir);
    if (!session) return;

    sessions.push({
      workspaceName,
      workspacePath,
      sessionId: session.sessionId,
      lastActiveAt: session.lastActiveAt,
      lastActiveLabel: relativeTime(session.lastActiveAt),
      agentType,
    });
  }));

  // Sort by most recently active first
  sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

  return sessions;
}

/** @internal exported for testing */
export function pathToProjectDirName(absPath: string, agentType: 'claude' | 'pi' = 'claude'): string {
  if (agentType === 'pi') {
    // Pi format: --Users-yotambloom-Work-workspaces-- (leading --, single - between segments, trailing --)
    // Strip leading /, then replace remaining / with -
    const inner = absPath.replace(/^\//, '').replace(/\//g, '-');
    return '--' + inner + '--';
  }
  // Claude format: -Users-yotambloom-Work-workspaces (/ replaced by -)
  return absPath.replace(/\//g, '-');
}

/** @internal exported for testing */
export function extractWorkspaceName(projDir: string, prefix: string, agentType: 'claude' | 'pi' = 'claude'): string | null {
  if (agentType === 'pi') {
    // Pi: prefix is "--Users-...-workspaces--", dir is "--Users-...-workspaces-{name}--"
    // The prefix ends with --, but workspace name is between prefix (minus trailing --) + - and trailing --
    const prefixBase = prefix.slice(0, -2); // remove trailing --
    if (!projDir.startsWith(prefixBase + '-')) return null;
    // Ensure dir is longer than just prefixBase + '--' (which would be the prefix itself)
    if (projDir === prefix) return null;
    const rest = projDir.slice(prefixBase.length + 1); // skip the - separator
    // rest should be "{workspace-name}--" — reject malformed dirs that don't end with --
    if (!rest.endsWith('--')) return null;
    const name = rest.slice(0, -2);
    return name || null;
  }
  // Claude: remove prefix + the separator dash
  const rest = projDir.slice(prefix.length + 1);
  if (!rest) return null;
  return rest;
}

interface SessionInfo {
  sessionId: string;
  lastActiveAt: Date;
}

/**
 * Find the most recently active session in a project directory.
 * Reads .jsonl files and checks the last line's timestamp.
 */
async function getMostRecentSession(projDir: string): Promise<SessionInfo | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(projDir);
  } catch {
    return null;
  }

  const jsonlFiles = entries.filter(f => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) return null;

  let bestSession: SessionInfo | null = null;

  // For performance, check file modification times first to find candidates
  const fileStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      try {
        const stat = await fs.stat(path.join(projDir, f));
        return { file: f, mtime: stat.mtime };
      } catch {
        return null;
      }
    })
  );

  // Sort by mtime descending, only check the most recent files
  const sorted = fileStats
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  // Only read the most recent session file to get accurate timestamp
  for (const { file, mtime } of sorted.slice(0, 1)) {
    const sessionId = file.replace('.jsonl', '');
    const timestamp = await getLastTimestamp(path.join(projDir, file));
    bestSession = {
      sessionId,
      lastActiveAt: timestamp || mtime,
    };
  }

  return bestSession;
}

/**
 * Read the last few lines of a .jsonl file and extract the most recent timestamp.
 */
async function getLastTimestamp(filePath: string): Promise<Date | null> {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      // Read last 4KB to find the last line with a timestamp
      const readSize = Math.min(4096, stat.size);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, Math.max(0, stat.size - readSize));
      const content = buffer.toString('utf-8');

      // Find the last line with a timestamp
      const lines = content.split('\n').filter(l => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.timestamp) {
            return new Date(parsed.timestamp);
          }
        } catch {
          continue;
        }
      }
    } finally {
      await handle.close();
    }
  } catch {
    // ignore
  }
  return null;
}

/** @internal exported for testing */
export function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
