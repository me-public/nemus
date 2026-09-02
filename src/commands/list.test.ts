import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockListWorkspaces,
  mockGetWorkspaceSessions,
  mockSearch,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockListWorkspaces: vi.fn(),
  mockGetWorkspaceSessions: vi.fn(),
  mockSearch: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('../utils/workspace-meta', () => ({
  listWorkspaces: mockListWorkspaces,
}));

vi.mock('../utils/claude-sessions', () => ({
  getWorkspaceSessions: mockGetWorkspaceSessions,
}));

vi.mock('../utils/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/colors', () => ({
  colorize: (text: string) => text,
}));

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
}));

vi.mock('../utils/prompt', () => ({
  search: mockSearch,
}));

vi.mock('fuzzy', () => ({
  filter: vi.fn(),
}));

import { main } from './list';
import { logInfo } from '../utils/logger';

function makeWorkspaceList(...names: string[]) {
  return names.map(name => ({
    name,
    path: `/test-workspaces/${name}`,
    metadata: {
      repositories: [{ name: 'repo-a', directoryName: 'repo-a', status: 'success' }],
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  }));
}

function makeArchivedWorkspaceList(...names: string[]) {
  return names.map(name => ({
    name,
    path: `/test-workspaces/${name}`,
    metadata: {
      repositories: [{ name: 'repo-a', directoryName: 'repo-a', status: 'success' }],
      createdAt: '2025-01-01T00:00:00.000Z',
      archivedAt: new Date().toISOString(),
    },
  }));
}

describe('list-workspaces main', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'list-workspaces.js'];
    mockWriteFile.mockResolvedValue(undefined);
    mockGetWorkspaceSessions.mockResolvedValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('lists workspaces and prompts for selection', async () => {
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b'));
    mockSearch.mockResolvedValueOnce('ws-a');

    await main();

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.workspace-last-go'),
      '/test-workspaces/ws-a',
      'utf-8',
    );
  });

  it('does not prompt when no workspaces exist', async () => {
    mockListWorkspaces.mockResolvedValueOnce([]);

    await main();

    expect(logInfo).toHaveBeenCalledWith('No workspaces found');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('does not prompt when no archived workspaces exist', async () => {
    process.argv = ['node', 'list-workspaces.js', '--archived'];
    mockListWorkspaces.mockResolvedValueOnce([]);

    await main();

    expect(logInfo).toHaveBeenCalledWith('No archived workspaces found');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('writes temp file on selection', async () => {
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('my-workspace'));
    mockSearch.mockResolvedValueOnce('my-workspace');

    await main();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.workspace-last-go'),
      '/test-workspaces/my-workspace',
      'utf-8',
    );
  });

  it('writes resume flag when workspace has an existing session', async () => {
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('my-workspace'));
    mockGetWorkspaceSessions.mockResolvedValueOnce([{
      workspaceName: 'my-workspace',
      workspacePath: '/test-workspaces/my-workspace',
      sessionId: 'session-123',
      lastActiveAt: new Date(),
      lastActiveLabel: '2m ago',
      agentType: 'pi',
    }]);
    mockSearch.mockResolvedValueOnce('my-workspace');

    await main();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.workspace-resume-session'),
      JSON.stringify({ sessionId: 'session-123', agentType: 'pi' }),
      'utf-8',
    );
  });

  it('does not write resume flag when workspace has no session', async () => {
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('my-workspace'));
    mockGetWorkspaceSessions.mockResolvedValueOnce([]);
    mockSearch.mockResolvedValueOnce('my-workspace');

    await main();

    const resumeCalls = mockWriteFile.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('.workspace-resume-session')
    );
    expect(resumeCalls).toHaveLength(0);
  });

  it('lists archived workspaces with --archived flag and prompts for selection', async () => {
    process.argv = ['node', 'list-workspaces.js', '--archived'];
    const archived = makeArchivedWorkspaceList('old-ws');
    mockListWorkspaces.mockResolvedValueOnce(archived);
    mockSearch.mockResolvedValueOnce('old-ws');

    await main();

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.workspace-last-go'),
      '/test-workspaces/old-ws',
      'utf-8',
    );
  });

  it('displays workspace name in the list output', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('ws-a'));
    mockSearch.mockResolvedValueOnce('ws-a');

    await main();

    const messages = logSpy.mock.calls.map(c => c[0]);
    expect(messages).toContainEqual(expect.stringContaining('ws-a'));
  });

  it('--json: writes one valid JSON document to stdout and does not prompt', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = ['node', 'list-workspaces.js', '--json'];
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b'));

    await main();

    expect(mockSearch).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(payload.count).toBe(2);
    expect(payload.workspaces.map((w: any) => w.name).sort()).toEqual(['ws-a', 'ws-b']);
    expect(payload.workspaces[0]).toMatchObject({ repoCount: 1, hasSession: false });
    writeSpy.mockRestore();
  });

  it('--json: empty list emits count 0, no prompt, no log noise', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = ['node', 'list-workspaces.js', '--json'];
    mockListWorkspaces.mockResolvedValueOnce([]);

    await main();

    expect(logInfo).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
    const payload = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(payload).toEqual({ archived: false, count: 0, workspaces: [] });
    writeSpy.mockRestore();
  });

  it('sorts workspaces with sessions before those without', async () => {
    mockListWorkspaces.mockResolvedValueOnce(makeWorkspaceList('no-session', 'has-session'));
    mockGetWorkspaceSessions.mockResolvedValueOnce([{
      workspaceName: 'has-session',
      workspacePath: '/test-workspaces/has-session',
      sessionId: 'session-456',
      lastActiveAt: new Date(),
      lastActiveLabel: '5m ago',
    }]);
    mockSearch.mockResolvedValueOnce('has-session');

    await main();

    // The prompt source function should show has-session first
    const promptCall = mockSearch.mock.calls[0][0];
    const source = promptCall.source;
    const items = await source('');
    expect(items[0].value).toBe('has-session');
    expect(items[1].value).toBe('no-session');
  });
});
