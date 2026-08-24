import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Mock fs/promises before importing the module
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  open: vi.fn(),
}));

vi.mock('./config', () => ({
  WORKSPACES_DIR: '/Users/test/workspaces',
}));

vi.mock('./agent-config', () => ({
  getActiveAgents: vi.fn().mockReturnValue([
    { type: 'claude', sessionProjectsDir: '/Users/test/.claude/projects' },
  ]),
}));

import * as fs from 'fs/promises';
import {
  getWorkspaceSessions,
  pathToProjectDirName,
  extractWorkspaceName,
  relativeTime,
} from './claude-sessions';

describe('pathToProjectDirName', () => {
  it('converts absolute path to Claude project dir format', () => {
    expect(pathToProjectDirName('/Users/test/workspaces')).toBe('-Users-test-workspaces');
  });

  it('handles paths with multiple segments', () => {
    expect(pathToProjectDirName('/Users/yotam/Work/workspaces')).toBe('-Users-yotam-Work-workspaces');
  });
});

describe('extractWorkspaceName', () => {
  const prefix = '-Users-test-workspaces';

  it('extracts simple workspace name', () => {
    expect(extractWorkspaceName('-Users-test-workspaces-my-project', prefix)).toBe('my-project');
  });

  it('extracts hyphenated workspace name', () => {
    expect(extractWorkspaceName('-Users-test-workspaces-auto-virtual-card-fix', prefix)).toBe('auto-virtual-card-fix');
  });

  it('returns null for trailing dash (no workspace name)', () => {
    expect(extractWorkspaceName('-Users-test-workspaces-', prefix)).toBe(null);
  });

  it('returns null when projDir equals prefix', () => {
    // prefix + 1 slices past the dir, giving empty string
    expect(extractWorkspaceName('-Users-test-workspaces', prefix)).toBe(null);
  });
});

describe('pathToProjectDirName (Pi)', () => {
  it('converts absolute path to Pi session dir format', () => {
    expect(pathToProjectDirName('/Users/test/workspaces', 'pi')).toBe('--Users-test-workspaces--');
  });

  it('handles paths with multiple segments', () => {
    expect(pathToProjectDirName('/Users/yotam/Work/workspaces', 'pi')).toBe('--Users-yotam-Work-workspaces--');
  });
});

describe('extractWorkspaceName (Pi)', () => {
  const prefix = '--Users-test-workspaces--';

  it('extracts simple workspace name', () => {
    expect(extractWorkspaceName('--Users-test-workspaces-my-project--', prefix, 'pi')).toBe('my-project');
  });

  it('extracts hyphenated workspace name', () => {
    expect(extractWorkspaceName('--Users-test-workspaces-auto-virtual-card-fix--', prefix, 'pi')).toBe('auto-virtual-card-fix');
  });

  it('returns null for empty workspace name', () => {
    expect(extractWorkspaceName('--Users-test-workspaces--', prefix, 'pi')).toBe(null);
  });

  it('returns null for malformed dir without trailing --', () => {
    expect(extractWorkspaceName('--Users-test-workspaces-my-project', prefix, 'pi')).toBe(null);
  });

  it('extracts single-char workspace name', () => {
    expect(extractWorkspaceName('--Users-test-workspaces-x--', prefix, 'pi')).toBe('x');
  });
});

describe('relativeTime', () => {
  it('returns "just now" for times less than a minute ago', () => {
    expect(relativeTime(new Date(Date.now() - 30_000))).toBe('just now');
  });

  it('returns minutes for times less than an hour ago', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
  });

  it('returns hours for times less than a day ago', () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000))).toBe('3h ago');
  });

  it('returns days for times less than a month ago', () => {
    expect(relativeTime(new Date(Date.now() - 7 * 86400_000))).toBe('7d ago');
  });

  it('returns months for times more than 30 days ago', () => {
    expect(relativeTime(new Date(Date.now() - 60 * 86400_000))).toBe('2mo ago');
  });
});

describe('getWorkspaceSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when claude projects dir does not exist', async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error('ENOENT'));

    const sessions = await getWorkspaceSessions();
    expect(sessions).toEqual([]);
  });

  it('returns empty array when no workspace project dirs exist', async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      '-Users-test-other-project' as any,
      '-Users-test-standalone' as any,
    ]);

    const sessions = await getWorkspaceSessions();
    expect(sessions).toEqual([]);
  });

  it('skips workspaces that no longer exist on disk', async () => {
    // Projects dir listing
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      '-Users-test-workspaces-deleted-workspace' as any,
    ]);

    // Workspace does not exist on disk
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));

    const sessions = await getWorkspaceSessions();
    expect(sessions).toEqual([]);
  });

  it('returns sessions sorted by last active time', async () => {
    const now = Date.now();

    // Projects dir listing - two workspace project dirs
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        '-Users-test-workspaces-workspace-a' as any,
        '-Users-test-workspaces-workspace-b' as any,
      ])
      // workspace-a session files
      .mockResolvedValueOnce([
        'session-a.jsonl' as any,
      ])
      // workspace-b session files
      .mockResolvedValueOnce([
        'session-b.jsonl' as any,
      ]);

    // Both workspaces exist
    vi.mocked(fs.access).mockResolvedValue(undefined);

    // File stats - workspace-b is newer
    const olderTime = new Date(now - 3600_000); // 1 hour ago
    const newerTime = new Date(now - 60_000); // 1 minute ago

    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ mtime: olderTime } as any)
      .mockResolvedValueOnce({ mtime: newerTime } as any);

    // Mock file open/read for timestamp extraction
    const mockHandleA = {
      stat: vi.fn().mockResolvedValue({ size: 100 }),
      read: vi.fn().mockImplementation((buffer: Buffer) => {
        const content = JSON.stringify({ timestamp: olderTime.toISOString() }) + '\n';
        buffer.write(content);
        return Promise.resolve({ bytesRead: content.length });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockHandleB = {
      stat: vi.fn().mockResolvedValue({ size: 100 }),
      read: vi.fn().mockImplementation((buffer: Buffer) => {
        const content = JSON.stringify({ timestamp: newerTime.toISOString() }) + '\n';
        buffer.write(content);
        return Promise.resolve({ bytesRead: content.length });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(fs.open)
      .mockResolvedValueOnce(mockHandleA as any)
      .mockResolvedValueOnce(mockHandleB as any);

    const sessions = await getWorkspaceSessions();

    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0].workspaceName).toBe('workspace-b');
    expect(sessions[1].workspaceName).toBe('workspace-a');
  });

  it('skips project dirs with no jsonl files', async () => {
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        '-Users-test-workspaces-empty-workspace' as any,
      ])
      // No jsonl files in the project dir
      .mockResolvedValueOnce([
        'some-uuid' as any, // directory, not a jsonl file
      ]);

    vi.mocked(fs.access).mockResolvedValue(undefined);

    const sessions = await getWorkspaceSessions();
    expect(sessions).toEqual([]);
  });

  it('falls back to mtime when jsonl has no timestamp', async () => {
    const mtime = new Date(Date.now() - 7200_000); // 2 hours ago

    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        '-Users-test-workspaces-fallback-ws' as any,
      ])
      .mockResolvedValueOnce([
        'session-1.jsonl' as any,
      ]);

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValueOnce({ mtime } as any);

    // File open fails - no timestamp extractable
    vi.mocked(fs.open).mockRejectedValueOnce(new Error('read error'));

    const sessions = await getWorkspaceSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspaceName).toBe('fallback-ws');
    expect(sessions[0].lastActiveAt).toEqual(mtime);
  });

  it('excludes the workspaces root dir itself', async () => {
    // The prefix dir itself should not match
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      '-Users-test-workspaces' as any, // This is the root, not a workspace
    ]);

    const sessions = await getWorkspaceSessions();
    expect(sessions).toEqual([]);
  });
});
