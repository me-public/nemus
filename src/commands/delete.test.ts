import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRm,
  mockListWorkspaces,
  mockPromptMultiWorkspaceSelection,
  mockConfirm,
} = vi.hoisted(() => ({
  mockRm: vi.fn(),
  mockListWorkspaces: vi.fn(),
  mockPromptMultiWorkspaceSelection: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  rm: mockRm,
}));

vi.mock('../utils/config', () => ({
  WORKSPACES_DIR: '/test-workspaces',
}));

vi.mock('../utils/workspace-meta', () => ({
  listWorkspaces: mockListWorkspaces,
}));

vi.mock('../utils/prompts', () => ({
  promptMultiWorkspaceSelection: mockPromptMultiWorkspaceSelection,
}));

vi.mock('../utils/logger', () => ({
  logInfo: vi.fn(),
  logSuccess: vi.fn(),
  logError: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock('../utils/colors', () => ({
  colorize: (text: string) => text,
}));

vi.mock('../utils/prompt', () => ({
  confirm: mockConfirm,
}));

import { main } from './delete';
import { logInfo, logSuccess, logError } from '../utils/logger';

function makeWorkspaceList(...names: string[]) {
  return names.map(name => ({
    name,
    path: `/test-workspaces/${name}`,
    metadata: {
      repositories: [{ name: 'repo-a' }],
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  }));
}

describe('delete-workspace main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('exits immediately when no workspaces exist', async () => {
    mockListWorkspaces.mockResolvedValueOnce([]);

    await main();

    expect(logInfo).toHaveBeenCalledWith('No more workspaces remaining');
    expect(mockPromptMultiWorkspaceSelection).not.toHaveBeenCalled();
  });

  it('deletes selected workspaces and exits when user declines "delete more"', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b'))  // initial fetch
      .mockResolvedValueOnce(makeWorkspaceList('ws-b'));          // after deletion check

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a']);

    mockConfirm
      .mockResolvedValueOnce(true)   // confirm deletion
      .mockResolvedValueOnce(false); // don't delete more

    await main();

    expect(mockRm).toHaveBeenCalledWith('/test-workspaces/ws-a', { recursive: true, force: true });
    expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('ws-a'));
  });

  it('deletes multiple workspaces in one batch', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b', 'ws-c'))
      .mockResolvedValueOnce(makeWorkspaceList('ws-c'));

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a', 'ws-b']);

    mockConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await main();

    expect(mockRm).toHaveBeenCalledTimes(2);
    expect(mockRm).toHaveBeenCalledWith('/test-workspaces/ws-a', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/test-workspaces/ws-b', { recursive: true, force: true });
  });

  it('skips deletion when user cancels confirmation', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a'))
      .mockResolvedValueOnce(makeWorkspaceList('ws-a'));

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a']);

    mockConfirm
      .mockResolvedValueOnce(false)   // cancel deletion
      .mockResolvedValueOnce(false);  // don't delete more

    await main();

    expect(mockRm).not.toHaveBeenCalled();
    // Should still ask "delete more?" — not exit immediately
    expect(mockConfirm).toHaveBeenCalledTimes(2);
  });

  it('loops when user wants to delete more', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b'))  // 1st iteration
      .mockResolvedValueOnce(makeWorkspaceList('ws-b'))           // after 1st deletion
      .mockResolvedValueOnce(makeWorkspaceList('ws-b'))           // 2nd iteration
      .mockResolvedValueOnce([]);                                  // after 2nd deletion

    mockPromptMultiWorkspaceSelection
      .mockResolvedValueOnce(['ws-a'])
      .mockResolvedValueOnce(['ws-b']);

    mockConfirm
      .mockResolvedValueOnce(true)    // confirm 1st deletion
      .mockResolvedValueOnce(true)   // delete more
      .mockResolvedValueOnce(true);   // confirm 2nd deletion

    await main();

    expect(mockRm).toHaveBeenCalledTimes(2);
    expect(mockRm).toHaveBeenCalledWith('/test-workspaces/ws-a', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/test-workspaces/ws-b', { recursive: true, force: true });
    // Should see "no more workspaces remaining" after all deleted
    expect(logInfo).toHaveBeenCalledWith('No more workspaces remaining');
  });

  it('breaks out of loop when no workspaces remain after deletion', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-only'))
      .mockResolvedValueOnce([]);  // none left after deletion

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-only']);
    mockConfirm.mockResolvedValueOnce(true);

    await main();

    expect(mockRm).toHaveBeenCalledTimes(1);
    expect(logInfo).toHaveBeenCalledWith('No more workspaces remaining');
    // Should NOT have asked "delete more?" since there are none left
    expect(mockConfirm).toHaveBeenCalledTimes(1); // only the confirm prompt
  });

  it('handles individual deletion failure without stopping others', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b', 'ws-c'))
      .mockResolvedValueOnce(makeWorkspaceList('ws-c'));

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a', 'ws-b']);

    mockRm
      .mockRejectedValueOnce(new Error('permission denied'))  // ws-a fails
      .mockResolvedValueOnce(undefined);                       // ws-b succeeds

    mockConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await main();

    expect(mockRm).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('ws-a'));
    expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('ws-b'));
  });

  it('uses singular message for single workspace confirmation', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-alpha'))
      .mockResolvedValueOnce([]);

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-alpha']);
    mockConfirm.mockResolvedValueOnce(true);

    await main();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Delete workspace ws-alpha?',
        default: true,
      })
    );
  });

  it('uses plural message for multiple workspace confirmation', async () => {
    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a', 'ws-b', 'ws-c'))
      .mockResolvedValueOnce([]);

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a', 'ws-b', 'ws-c']);
    mockConfirm.mockResolvedValueOnce(true);

    await main();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Delete these 3 workspaces?',
        default: true,
      })
    );
  });

  it('shows workspace details including repo count and creation date', async () => {
    const logSpy = vi.spyOn(console, 'log');

    mockListWorkspaces
      .mockResolvedValueOnce(makeWorkspaceList('ws-a'))
      .mockResolvedValueOnce([]);

    mockPromptMultiWorkspaceSelection.mockResolvedValueOnce(['ws-a']);
    mockConfirm.mockResolvedValueOnce(true);

    await main();

    const messages = logSpy.mock.calls.map(c => c[0]);
    expect(messages).toContainEqual(expect.stringContaining('Repositories: 1'));
    expect(messages).toContainEqual(expect.stringContaining('/test-workspaces/ws-a'));
  });
});
