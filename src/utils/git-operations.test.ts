import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cloneRepositories, cloneSingleRepo } from './git-operations';
import { GitHubRepo } from '../types';

// Mock child_process.exec
const mockExecAsync = vi.fn();
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    const command = args[0] as string;
    const opts = args.length === 3 ? args[1] : {};
    // Forward to our mockExecAsync which returns a promise
    mockExecAsync(command, opts)
      .then((result: { stdout: string; stderr: string }) => callback(null, result))
      .catch((err: Error) => callback(err, { stdout: '', stderr: '' }));
  },
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    const file = args[0] as string;
    const fileArgs = Array.isArray(args[1]) ? (args[1] as string[]) : [];
    const opts = typeof args[2] === 'object' && args[2] !== null ? args[2] : {};
    // Record the raw argv so tests can assert no-shell/argv separation.
    mockExecFile(file, fileArgs, opts);
    // Forward as a reconstructed command string so existing expectations match.
    mockExecAsync([file, ...fileArgs].join(' '), opts)
      .then((result: { stdout: string; stderr: string }) => callback(null, result))
      .catch((err: Error) => callback(err, { stdout: '', stderr: '' }));
  },
}));

vi.mock('fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./logger', () => ({
  logSuccess: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock('./colors', () => ({
  colorize: (text: string) => text,
}));

vi.mock('./ghq-integration', () => ({
  isGhqInstalled: vi.fn().mockResolvedValue(false),
  cloneWithGhq: vi.fn(),
  describeCloneError: (e: { message?: string }) => (e && e.message) || 'Unknown error',
}));

vi.mock('./retry', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('./progress', () => ({
  createSimpleProgressBar: vi.fn(() => ({
    start: vi.fn(),
    update: vi.fn(),
    stop: vi.fn(),
  })),
}));

function makeRepo(name: string, sshUrl?: string): GitHubRepo {
  return {
    name,
    url: `https://github.com/org/${name}`,
    sshUrl: sshUrl ?? `git@github.com:org/${name}.git`,
    owner: { login: 'org' },
    description: `${name} repo`,
    isPrivate: false,
  };
}

describe('cloneRepositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all exec commands succeed
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('clones unique repos normally', async () => {
    const repoA = makeRepo('repo-a');
    const repoB = makeRepo('repo-b');

    const results = await cloneRepositories(
      [
        { repo: repoA, directoryName: 'repo-a' },
        { repo: repoB, directoryName: 'repo-b' },
      ],
      '/workspace'
    );

    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === 'success')).toBe(true);
    expect(results[0].directoryName).toBe('repo-a');
    expect(results[1].directoryName).toBe('repo-b');

    // Should have 2 git clone calls (one per unique repo), no --local calls
    const cloneCalls = mockExecAsync.mock.calls.filter(
      ([cmd]: [string]) => typeof cmd === 'string' && cmd.includes('git clone')
    );
    expect(cloneCalls).toHaveLength(2);
    const localCalls = cloneCalls.filter(([cmd]: [string]) => cmd.includes('--local'));
    expect(localCalls).toHaveLength(0);
  });

  it('uses --local for duplicate repos', async () => {
    const repo = makeRepo('platform-app');

    const results = await cloneRepositories(
      [
        { repo, directoryName: 'platform-app-1' },
        { repo, directoryName: 'platform-app-2' },
        { repo, directoryName: 'platform-app-3' },
      ],
      '/workspace'
    );

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'success')).toBe(true);

    // First should be a normal clone, 2nd and 3rd via --local
    const cloneCalls = mockExecAsync.mock.calls.filter(
      ([cmd]: [string]) => typeof cmd === 'string' && cmd.includes('git clone')
    );
    const normalClones = cloneCalls.filter(([cmd]: [string]) => !cmd.includes('--local'));
    const localClones = cloneCalls.filter(([cmd]: [string]) => cmd.includes('--local'));

    expect(normalClones).toHaveLength(1);
    expect(localClones).toHaveLength(2);

    // --local clones should reference the first instance's path as source
    for (const [cmd] of localClones) {
      expect(cmd).toContain('/workspace/platform-app-1');
    }
  });

  it('sets correct remote origin on --local clones', async () => {
    const repo = makeRepo('platform-app');

    await cloneRepositories(
      [
        { repo, directoryName: 'app-1' },
        { repo, directoryName: 'app-2' },
      ],
      '/workspace'
    );

    // Should have set-url calls for the --local copies
    const setUrlCalls = mockExecAsync.mock.calls.filter(
      ([cmd]: [string]) => typeof cmd === 'string' && cmd.includes('git remote set-url origin')
    );

    expect(setUrlCalls).toHaveLength(1);
    expect(setUrlCalls[0][0]).toContain(repo.sshUrl);
    expect(setUrlCalls[0][1]).toEqual(expect.objectContaining({ cwd: '/workspace/app-2' }));
  });

  it('clones via execFile with separated argv (no shell), preserving spaces in the path', async () => {
    const repo = makeRepo('platform-app');
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    // Directory name with a space would break unquoted shell interpolation.
    const result = await cloneSingleRepo(repo, '/work space', 'dir with space', false);

    expect(result.status).toBe('success');
    const cloneCall = mockExecFile.mock.calls.find(c => c[1]?.[0] === 'clone');
    expect(cloneCall).toBeDefined();
    expect(cloneCall![0]).toBe('git');
    expect(cloneCall![1]).toEqual(['clone', repo.sshUrl, '/work space/dir with space']);
    // Argv separation means no arg is a joined shell string.
    expect(cloneCall![1].some((a: string) => a.includes(' clone '))).toBe(false);
  });

  it('marks remaining instances as failed when primary clone fails', async () => {
    const repo = makeRepo('broken-repo');

    // Make git clone fail
    mockExecAsync.mockRejectedValue(new Error('clone failed'));

    const results = await cloneRepositories(
      [
        { repo, directoryName: 'broken-1' },
        { repo, directoryName: 'broken-2' },
        { repo, directoryName: 'broken-3' },
      ],
      '/workspace'
    );

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'failed')).toBe(true);
    expect(results[0].error).toBe('clone failed');
    expect(results[1].error).toBe('Primary clone failed');
    expect(results[2].error).toBe('Primary clone failed');
  });

  it('handles mix of unique and duplicate repos', async () => {
    const repoA = makeRepo('repo-a');
    const repoB = makeRepo('repo-b');

    const results = await cloneRepositories(
      [
        { repo: repoA, directoryName: 'repo-a-1' },
        { repo: repoA, directoryName: 'repo-a-2' },
        { repo: repoB, directoryName: 'repo-b-1' },
      ],
      '/workspace'
    );

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'success')).toBe(true);

    const cloneCalls = mockExecAsync.mock.calls.filter(
      ([cmd]: [string]) => typeof cmd === 'string' && cmd.includes('git clone')
    );
    const normalClones = cloneCalls.filter(([cmd]: [string]) => !cmd.includes('--local'));
    const localClones = cloneCalls.filter(([cmd]: [string]) => cmd.includes('--local'));

    // 2 normal clones (one per unique repo), 1 --local clone for the duplicate
    expect(normalClones).toHaveLength(2);
    expect(localClones).toHaveLength(1);
    expect(localClones[0][0]).toContain('/workspace/repo-a-1');
  });

  it('handles --local clone failure independently', async () => {
    const repo = makeRepo('platform-app');

    // First clone succeeds, --local clone fails
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git clone (normal)
      .mockRejectedValueOnce(new Error('local clone failed')); // git clone --local

    const results = await cloneRepositories(
      [
        { repo, directoryName: 'app-1' },
        { repo, directoryName: 'app-2' },
      ],
      '/workspace'
    );

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[0].directoryName).toBe('app-1');
    expect(results[1].status).toBe('failed');
    expect(results[1].directoryName).toBe('app-2');
    expect(results[1].error).toBe('local clone failed');
  });

  it('returns correct clonedAt timestamp on success', async () => {
    const repo = makeRepo('repo-a');

    const before = new Date().toISOString();
    const results = await cloneRepositories(
      [{ repo, directoryName: 'repo-a' }],
      '/workspace'
    );
    const after = new Date().toISOString();

    expect(results[0].clonedAt).toBeDefined();
    expect(results[0].clonedAt! >= before).toBe(true);
    expect(results[0].clonedAt! <= after).toBe(true);
  });
});
