import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrompt } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
}));

// Mock inquirer before imports
vi.mock('inquirer', () => ({
  default: {
    prompt: mockPrompt,
    registerPrompt: vi.fn(),
  },
}));

vi.mock('inquirer-autocomplete-prompt', () => ({
  default: {},
}));

vi.mock('fuzzy', () => ({
  filter: (input: string, list: string[]) => {
    const lower = input.toLowerCase();
    return list
      .filter(item => item.toLowerCase().includes(lower))
      .map(item => ({ original: item, string: item }));
  },
}));

vi.mock('./colors', () => ({
  colorize: (text: string) => text,
}));

vi.mock('./validation', () => ({
  validateWorkspaceName: vi.fn().mockReturnValue(true),
  checkWorkspaceExists: vi.fn().mockResolvedValue(false),
  sanitizeWorkspaceName: vi.fn((input: string) => input),
}));

import { promptMultiWorkspaceSelection } from './prompts';

const makeWorkspaces = (...names: string[]) =>
  names.map(name => ({
    name,
    path: `/workspaces/${name}`,
    metadata: { repositories: [], createdAt: new Date().toISOString() },
  }));

describe('promptMultiWorkspaceSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns selected workspace names', async () => {
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'ws-beta' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta', 'ws-gamma')
    );

    expect(result).toEqual(['ws-alpha', 'ws-beta']);
  });

  it('requires at least one selection before accepting done', async () => {
    // First "done" should be rejected, then select one, then done
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'done' })
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta')
    );

    expect(result).toEqual(['ws-alpha']);
    // Should have prompted 3 times (done rejected, select, done accepted)
    expect(mockPrompt).toHaveBeenCalledTimes(3);
  });

  it('auto-completes when all workspaces are selected', async () => {
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'ws-beta' });

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta')
    );

    expect(result).toEqual(['ws-alpha', 'ws-beta']);
    // Only 2 prompts needed - loop breaks when no available names left
    expect(mockPrompt).toHaveBeenCalledTimes(2);
  });

  it('returns single workspace selection', async () => {
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-only' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-only', 'ws-other')
    );

    expect(result).toEqual(['ws-only']);
  });

  it('exits process on Ctrl+C', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    mockPrompt.mockRejectedValueOnce(new Error('User force closed'));

    await expect(
      promptMultiWorkspaceSelection(makeWorkspaces('ws-alpha'))
    ).rejects.toThrow('process.exit');

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
  });

  it('prints summary with correct singular form', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    await promptMultiWorkspaceSelection(makeWorkspaces('ws-alpha', 'ws-beta'));

    const summaryCalls = logSpy.mock.calls.map(c => c[0]);
    expect(summaryCalls).toContainEqual(
      expect.stringContaining('Selected 1 workspace:')
    );
  });

  it('prints summary with correct plural form', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'ws-beta' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta', 'ws-gamma')
    );

    const summaryCalls = logSpy.mock.calls.map(c => c[0]);
    expect(summaryCalls).toContainEqual(
      expect.stringContaining('Selected 2 workspaces:')
    );
  });

  it('prints green confirmation after each selection', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockPrompt
      .mockResolvedValueOnce({ workspaceName: 'ws-alpha' })
      .mockResolvedValueOnce({ workspaceName: 'ws-beta' })
      .mockResolvedValueOnce({ workspaceName: 'done' });

    await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta', 'ws-gamma')
    );

    const loggedMessages = logSpy.mock.calls.map(c => c[0]);
    expect(loggedMessages).toContainEqual(expect.stringContaining('Added: ws-alpha'));
    expect(loggedMessages).toContainEqual(expect.stringContaining('Added: ws-beta'));
  });
});
