import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record execFile invocations; every git call must pass args as an argv ARRAY
// (no shell), so a branch name with shell metacharacters is inert.
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, r: { stdout: string; stderr: string }) => void;
    mockExecFile(args[0], args[1], args[2]);
    cb(null, { stdout: '', stderr: '' });
  },
}));
vi.mock('./git-status', () => ({ hasUncommittedChanges: vi.fn().mockResolvedValue(false) }));

import { createBranch } from './branch-operations';

describe('branch-operations argv safety (no shell injection)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a malicious branch name as a single argv element, never a shell string', async () => {
    const evil = 'foo$(touch /tmp/pwned)';
    const res = await createBranch('/repo', 'api', evil);
    expect(res.success).toBe(true);

    // Every call is execFile('git', [...args]) — args is an array, and the evil
    // name appears verbatim as one element (so the shell never sees it).
    for (const [bin, args] of mockExecFile.mock.calls) {
      expect(bin).toBe('git');
      expect(Array.isArray(args)).toBe(true);
    }
    const checkout = mockExecFile.mock.calls.find(([, a]) => (a as string[])[0] === 'checkout');
    expect(checkout![1]).toEqual(['checkout', '-b', evil]);
  });

  it('checks out a base branch as its own argv element too', async () => {
    await createBranch('/repo', 'api', 'feature', 'release/1.0');
    const calls = mockExecFile.mock.calls.map(([, a]) => a as string[]);
    expect(calls).toContainEqual(['checkout', 'release/1.0']);
    expect(calls).toContainEqual(['checkout', '-b', 'feature']);
  });
});
