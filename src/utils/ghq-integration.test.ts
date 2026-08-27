import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecAsync = vi.fn();
const mockExecFile = vi.fn();
// ghqRepoExists now uses fs.stat (not `test -d`); cleanup uses fs.rm.
const mockStat = vi.fn();
const mockRm = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', () => ({
  stat: (...a: unknown[]) => mockStat(...a),
  rm: (...a: unknown[]) => mockRm(...a),
}));
const cached = () => mockStat.mockResolvedValue({ isDirectory: () => true });
vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    const command = args[0] as string;
    const opts = args.length === 3 ? args[1] : {};
    mockExecAsync(command, opts)
      .then((result: { stdout: string; stderr: string }) => callback(null, result))
      .catch((err: Error) => callback(err, { stdout: '', stderr: '' }));
  },
  // execFile(file, args, [opts], cb): reconstruct a command string so existing
  // expectations that assert on the command keep working, and record argv.
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    const file = args[0] as string;
    const fileArgs = Array.isArray(args[1]) ? (args[1] as string[]) : [];
    const opts = typeof args[2] === 'object' && args[2] !== null ? args[2] : {};
    mockExecFile(file, fileArgs, opts);
    mockExecAsync([file, ...fileArgs].join(' '), opts)
      .then((result: { stdout: string; stderr: string }) => callback(null, result))
      .catch((err: Error) => callback(err, { stdout: '', stderr: '' }));
  },
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

import { cloneWithGhq, describeCloneError } from './ghq-integration';

describe('cloneWithGhq', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
    // default: not cached (fs.stat rejects) unless a test opts into cached()
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  it('uses git clone --local from ghq cache when repo exists', async () => {
    cached();
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.resolve({ stdout: '/usr/bin/ghq\n', stderr: '' });
      if (cmd === 'ghq root') return Promise.resolve({ stdout: '/home/user/ghq\n', stderr: '' });
      if (cmd.startsWith('git clone --local')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git remote set-url')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    expect(result.success).toBe(true);
    expect(result.usedGhq).toBe(true);

    // Should use git clone --local, not cp -R
    const calls = mockExecAsync.mock.calls.map(([cmd]: [string]) => cmd);
    expect(calls.some((cmd: string) => cmd.includes('git clone --local'))).toBe(true);
    expect(calls.some((cmd: string) => cmd.includes('cp -R'))).toBe(false);

    // Should set remote URL back to original
    expect(calls.some((cmd: string) => cmd.includes('git remote set-url origin'))).toBe(true);
  });

  it('does not call ghq get -u when repo is already cached', async () => {
    cached();
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.resolve({ stdout: '/usr/bin/ghq\n', stderr: '' });
      if (cmd === 'ghq root') return Promise.resolve({ stdout: '/home/user/ghq\n', stderr: '' });
      if (cmd.startsWith('git clone --local')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git remote set-url')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    const calls = mockExecAsync.mock.calls.map(([cmd]: [string]) => cmd);
    // Should NOT call ghq get since repo is cached
    expect(calls.some((cmd: string) => cmd.startsWith('ghq get'))).toBe(false);
  });

  it('calls ghq get (without -u) when repo is not cached', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.resolve({ stdout: '/usr/bin/ghq\n', stderr: '' });
      if (cmd === 'ghq root') return Promise.resolve({ stdout: '/home/user/ghq\n', stderr: '' });
      if (cmd.startsWith('test -d')) return Promise.reject(new Error('not found'));
      if (cmd.startsWith('ghq get')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git clone --local')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git remote set-url')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    const calls = mockExecAsync.mock.calls.map(([cmd]: [string]) => cmd);
    const ghqGetCalls = calls.filter((cmd: string) => cmd.startsWith('ghq get'));
    expect(ghqGetCalls).toHaveLength(1);
    // Should NOT use -u flag
    expect(ghqGetCalls[0]).not.toContain('-u');
  });

  it('skips local clone and falls back to direct clone when ghq get fails', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.resolve({ stdout: '/usr/bin/ghq\n', stderr: '' });
      if (cmd === 'ghq root') return Promise.resolve({ stdout: '/home/user/ghq\n', stderr: '' });
      if (cmd.startsWith('test -d')) return Promise.reject(new Error('not found'));
      if (cmd.startsWith('ghq get')) return Promise.reject(new Error('network error'));
      if (cmd.startsWith('git clone')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    expect(result.success).toBe(true);
    expect(result.usedGhq).toBe(false);

    const calls = mockExecAsync.mock.calls.map(([cmd]: [string]) => cmd);
    // Should NOT attempt git clone --local since ghq get failed
    expect(calls.some((cmd: string) => cmd.includes('--local'))).toBe(false);
    // Should fall back to direct clone (argv form: no shell quotes)
    expect(calls.some((cmd: string) => cmd.startsWith('git clone git@github.com'))).toBe(true);
  });

  it('falls back to direct git clone when ghq is not installed', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.reject(new Error('not found'));
      if (cmd.startsWith('git clone')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    expect(result.success).toBe(true);
    expect(result.usedGhq).toBe(false);

    const calls = mockExecAsync.mock.calls.map(([cmd]: [string]) => cmd);
    expect(calls.some((cmd: string) => cmd.startsWith('git clone git@github.com'))).toBe(true);
    expect(calls.some((cmd: string) => cmd.includes('--local'))).toBe(false);
  });

  it('falls back to direct git clone when local clone fails', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd === 'which ghq') return Promise.resolve({ stdout: '/usr/bin/ghq\n', stderr: '' });
      if (cmd === 'ghq root') return Promise.resolve({ stdout: '/home/user/ghq\n', stderr: '' });
      if (cmd.startsWith('test -d')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git clone --local')) return Promise.reject(new Error('local clone failed'));
      if (cmd.startsWith('rm -rf')) return Promise.resolve({ stdout: '', stderr: '' });
      if (cmd.startsWith('git clone')) return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const result = await cloneWithGhq('git@github.com:acme/platform-app.git', '/workspace/platform-app');

    expect(result.success).toBe(true);
    expect(result.usedGhq).toBe(false);
  });
});

describe('describeCloneError', () => {
  it('explains a timeout (killed + SIGTERM) with actionable fixes', () => {
    const err = Object.assign(new Error('Command failed: git clone https://…'), {
      killed: true,
      signal: 'SIGTERM',
      stderr: "Cloning into '/x'...",
    });
    const msg = describeCloneError(err, 15 * 60 * 1000);
    expect(msg).toContain('timed out after 15 min');
    expect(msg).toContain('ghq');
    expect(msg).toContain('WORKSPACE_CLONE_TIMEOUT_MS');
  });

  it('explains ETIMEDOUT code as a timeout', () => {
    const err = Object.assign(new Error('boom'), { code: 'ETIMEDOUT' });
    expect(describeCloneError(err, 5 * 60 * 1000)).toContain('timed out after 5 min');
  });

  it('explains a maxBuffer kill', () => {
    const err = Object.assign(new Error('boom'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    expect(describeCloneError(err)).toContain('buffer limit');
  });

  it('classifies a maxBuffer kill as buffer (not timeout) even when killed=true', () => {
    // Node sets killed=true on maxBuffer kills too; the buffer branch must win.
    const err = Object.assign(new Error('boom'), {
      killed: true,
      signal: 'SIGTERM',
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    });
    const msg = describeCloneError(err, 15 * 60 * 1000);
    expect(msg).toContain('buffer limit');
    expect(msg).not.toContain('timed out');
  });

  it('falls back to message + stderr tail for ordinary failures', () => {
    const err = Object.assign(new Error('fatal: repository not found'), {
      stderr: 'remote: Repository not found.\nfatal: repository not found',
    });
    const msg = describeCloneError(err);
    expect(msg).toContain('fatal: repository not found');
    expect(msg).toContain('git:');
    expect(msg).not.toContain('timed out');
  });
});
