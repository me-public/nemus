import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearch, mockInput } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockInput: vi.fn(),
}));

// Mock the modular prompt module. promptMultiWorkspaceSelection uses search();
// the modular API returns the selected VALUE directly (not { name: value }).
vi.mock('./prompt', () => ({
  search: mockSearch,
  input: mockInput,
  confirm: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  password: vi.fn(),
  Separator: class {},
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

import { promptMultiWorkspaceSelection, promptWorkspaceName } from './prompts';
import { validateWorkspaceName, sanitizeWorkspaceName } from './validation';

const makeWorkspaces = (...names: string[]) =>
  names.map(name => ({
    name,
    path: `/workspaces/${name}`,
    metadata: { repositories: [], createdAt: new Date().toISOString() },
  }));

describe('promptWorkspaceName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('validates the SANITIZED name, not the raw input (classic filter-before-validate parity)', async () => {
    // Classic inquirer ran filter (sanitize) BEFORE validate, so a name like
    // "My Workspace" was validated as "my-workspace". Regression guard.
    (sanitizeWorkspaceName as any).mockImplementation((s: string) =>
      s.trim().toLowerCase().replace(/ +/g, '-'));
    (validateWorkspaceName as any).mockReturnValue(true);

    mockInput.mockImplementation(async (opts: any) => {
      // Simulate the user submitting a raw value containing a space.
      opts.validate('My Workspace');
      return 'My Workspace';
    });

    const result = await promptWorkspaceName();

    // validate must have seen the sanitized value, and the return is sanitized.
    expect(validateWorkspaceName).toHaveBeenCalledWith('my-workspace');
    expect(result).toBe('my-workspace');
  });
});

describe('promptMultiWorkspaceSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns selected workspace names', async () => {
    mockSearch
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('ws-beta')
      .mockResolvedValueOnce('done');

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta', 'ws-gamma')
    );

    expect(result).toEqual(['ws-alpha', 'ws-beta']);
  });

  it('requires at least one selection before accepting done', async () => {
    // First "done" should be rejected, then select one, then done
    mockSearch
      .mockResolvedValueOnce('done')
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('done');

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta')
    );

    expect(result).toEqual(['ws-alpha']);
    // Should have prompted 3 times (done rejected, select, done accepted)
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });

  it('auto-completes when all workspaces are selected', async () => {
    mockSearch
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('ws-beta');

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta')
    );

    expect(result).toEqual(['ws-alpha', 'ws-beta']);
    // Only 2 prompts needed - loop breaks when no available names left
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('returns single workspace selection', async () => {
    mockSearch
      .mockResolvedValueOnce('ws-only')
      .mockResolvedValueOnce('done');

    const result = await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-only', 'ws-other')
    );

    expect(result).toEqual(['ws-only']);
  });

  it('exits process on Ctrl+C', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    mockSearch.mockRejectedValueOnce(new Error('User force closed'));

    await expect(
      promptMultiWorkspaceSelection(makeWorkspaces('ws-alpha'))
    ).rejects.toThrow('process.exit');

    expect(mockExit).toHaveBeenCalledWith(0);
    mockExit.mockRestore();
  });

  it('prints summary with correct singular form', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockSearch
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('done');

    await promptMultiWorkspaceSelection(makeWorkspaces('ws-alpha', 'ws-beta'));

    const summaryCalls = logSpy.mock.calls.map(c => c[0]);
    expect(summaryCalls).toContainEqual(
      expect.stringContaining('Selected 1 workspace:')
    );
  });

  it('prints summary with correct plural form', async () => {
    const logSpy = vi.spyOn(console, 'log');
    mockSearch
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('ws-beta')
      .mockResolvedValueOnce('done');

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
    mockSearch
      .mockResolvedValueOnce('ws-alpha')
      .mockResolvedValueOnce('ws-beta')
      .mockResolvedValueOnce('done');

    await promptMultiWorkspaceSelection(
      makeWorkspaces('ws-alpha', 'ws-beta', 'ws-gamma')
    );

    const loggedMessages = logSpy.mock.calls.map(c => c[0]);
    expect(loggedMessages).toContainEqual(expect.stringContaining('Added: ws-alpha'));
    expect(loggedMessages).toContainEqual(expect.stringContaining('Added: ws-beta'));
  });
});
