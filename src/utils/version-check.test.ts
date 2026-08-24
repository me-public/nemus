import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    mockExecFile(args[0], args[1], args[2])
      .then((result: { stdout: string; stderr: string }) => callback(null, result))
      .catch((err: Error) => callback(err, { stdout: '', stderr: '' }));
  },
}));

// Mock config
vi.mock('./config', () => ({
  CACHE_DIR: '/tmp/test-cache',
  getPackageVersion: () => '2.20.0',
}));

import { checkForUpdate } from './version-check';
import * as fs from 'fs/promises';

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when current version matches latest', async () => {
    // No cached check
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    // npm returns same version
    mockExecFile.mockResolvedValueOnce({ stdout: '2.20.0\n', stderr: '' });

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns update message when newer version is available', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    mockExecFile.mockResolvedValueOnce({ stdout: '2.21.0\n', stderr: '' });

    const result = await checkForUpdate();
    expect(result).toContain('Update available');
    expect(result).toContain('2.20.0');
    expect(result).toContain('2.21.0');
  });

  it('returns null when npm check fails', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    mockExecFile.mockRejectedValueOnce(new Error('npm timeout'));

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('uses cached result when within 24h', async () => {
    const recentCheck = JSON.stringify({
      checkedAt: new Date().toISOString(),
      latestVersion: '3.0.0',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(recentCheck);

    const result = await checkForUpdate();
    expect(result).toContain('Update available');
    // Should NOT have called npm
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns null from cache when version is current', async () => {
    const recentCheck = JSON.stringify({
      checkedAt: new Date().toISOString(),
      latestVersion: '2.20.0',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(recentCheck);

    const result = await checkForUpdate();
    expect(result).toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('re-checks npm when cache is stale (>24h)', async () => {
    const staleCheck = JSON.stringify({
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latestVersion: '2.20.0',
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(staleCheck);
    mockExecFile.mockResolvedValueOnce({ stdout: '2.22.0\n', stderr: '' });

    const result = await checkForUpdate();
    expect(result).toContain('2.22.0');
    expect(mockExecFile).toHaveBeenCalled();
  });

  it('returns null when current is newer than latest (dev version)', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    mockExecFile.mockResolvedValueOnce({ stdout: '2.19.0\n', stderr: '' });

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });
});
