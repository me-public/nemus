import { describe, it, expect, vi } from 'vitest';
import { parseFixPrEnv, runFixPr, FixPrDeps } from './fix-pr';
import { CheckRun, GitForge } from '../gitforge/types';
import { GitOps, AgentInvoker } from './types';
import { ForgeTokenSource } from '../forge/types';
import { Notifier } from '../notify/types';

const tokenSource: ForgeTokenSource = {
  id: 'test',
  getToken: async () => ({ token: 'ghs_secret', expiresAt: new Date('2030-01-01') }),
};

function fakeGit(overrides: Partial<GitOps> = {}): GitOps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clone: async (url, dir) => { calls.push(`clone ${dir}`); },
    checkout: async (dir, br) => { calls.push(`checkout ${br}`); },
    checkoutNewBranch: async () => {},
    hasChanges: async () => true,
    commitAll: async () => { calls.push('commit'); },
    push: async () => { calls.push('push'); },
    ...overrides,
  } as GitOps & { calls: string[] };
}

/** Forge whose getChecks returns a scripted sequence of check snapshots. */
function scriptedForge(snapshots: CheckRun[][]): GitForge & { comments: any[] } {
  let i = 0;
  const comments: any[] = [];
  return {
    id: 'fake',
    comments,
    openPR: async () => ({ number: 1, url: 'u', state: 'open' }),
    getChecks: async () => snapshots[Math.min(i++, snapshots.length - 1)],
    comment: async (c) => { comments.push(c); },
  } as GitForge & { comments: any[] };
}

const noSleep = async () => {};

describe('parseFixPrEnv', () => {
  const base = { NEMUS_REPOS: 'acme/api', NEMUS_PR_NUMBER: '42', NEMUS_PR_BRANCH: 'nemus/fix' };

  it('parses the required fields', () => {
    const c = parseFixPrEnv(base);
    expect(c.repo.full).toBe('acme/api');
    expect(c.prNumber).toBe(42);
    expect(c.branch).toBe('nemus/fix');
    expect(c.agent).toBe('pi');
    expect(c.workdir).toBe('/workspace');
  });

  it('fills a bare repo name from NEMUS_OWNER', () => {
    expect(parseFixPrEnv({ ...base, NEMUS_REPOS: 'api', NEMUS_OWNER: 'acme' }).repo.full).toBe('acme/api');
  });

  it('rejects missing/invalid inputs', () => {
    expect(() => parseFixPrEnv({ NEMUS_PR_NUMBER: '1', NEMUS_PR_BRANCH: 'b' })).toThrow(/NEMUS_REPOS is required/);
    expect(() => parseFixPrEnv({ ...base, NEMUS_REPOS: 'a/b,c/d' })).toThrow(/single repo/);
    expect(() => parseFixPrEnv({ ...base, NEMUS_PR_BRANCH: '' })).toThrow(/NEMUS_PR_BRANCH is required/);
    expect(() => parseFixPrEnv({ ...base, NEMUS_PR_NUMBER: '' })).toThrow(/NEMUS_PR_NUMBER is required/);
    expect(() => parseFixPrEnv({ ...base, NEMUS_PR_NUMBER: 'x' })).toThrow(/non-negative integer/);
  });

  it('reads CI tuning overrides', () => {
    const c = parseFixPrEnv({ ...base, NEMUS_CI_MAX_ITERATIONS: '2', NEMUS_CI_POLL_INTERVAL_MS: '100', NEMUS_CI_MAX_POLLS: '5' });
    expect(c.maxIterations).toBe(2);
    expect(c.pollIntervalMs).toBe(100);
    expect(c.maxPollsPerIteration).toBe(5);
  });
});

describe('runFixPr', () => {
  const cfg = parseFixPrEnv({ NEMUS_REPOS: 'acme/api', NEMUS_PR_NUMBER: '42', NEMUS_PR_BRANCH: 'nemus/fix', NEMUS_WORKDIR: '/w' });

  it('clones + checks out the PR head, then greens immediately', async () => {
    const git = fakeGit();
    const agent: AgentInvoker = { run: vi.fn(async () => {}) };
    const forge = scriptedForge([[{ name: 'build', status: 'completed', conclusion: 'success' }]]);
    const deps: FixPrDeps = { git, agent, forge, tokenSource, sleep: noSleep };

    const res = await runFixPr(cfg, deps);
    expect(res.mode).toBe('fix-pr');
    expect(res.ok).toBe(true);
    expect(res.ci).toEqual({ ok: true, state: 'green', iterations: 0 });
    expect(git.calls.slice(0, 2)).toEqual(['clone /w/api', 'checkout nemus/fix']);
    expect(agent.run).not.toHaveBeenCalled(); // already green → no fix pass
    expect(res.repos[0]).toMatchObject({ repo: 'acme/api', cloned: true, prNumber: 42, changed: false });
  });

  it('runs a fix pass on failure, then greens (records an iteration + notifies)', async () => {
    const git = fakeGit();
    const agent: AgentInvoker = { run: vi.fn(async () => {}) };
    const forge = scriptedForge([
      [{ name: 'build', status: 'completed', conclusion: 'failure' }],
      [{ name: 'build', status: 'completed', conclusion: 'success' }],
    ]);
    const events: any[] = [];
    const notifier: Notifier = { notify: async (e) => { events.push(e); } };
    const res = await runFixPr(cfg, { git, agent, forge, tokenSource, sleep: noSleep, notifier });

    expect(agent.run).toHaveBeenCalledOnce();
    expect(git.calls).toContain('commit');
    expect(git.calls).toContain('push');
    expect(res.ok).toBe(true);
    expect(res.ci).toEqual({ ok: true, state: 'green', iterations: 1 });
    expect(res.repos[0]).toMatchObject({ changed: true, pushed: true });
    expect(events.map((e) => e.event)).toContain('ci_green');
  });

  it('reports a clone failure as a top-level error (no CI-loop)', async () => {
    const git = fakeGit({ clone: async () => { throw new Error('auth denied'); } });
    const agent: AgentInvoker = { run: vi.fn(async () => {}) };
    const forge = scriptedForge([[]]);
    const res = await runFixPr(cfg, { git, agent, forge, tokenSource, sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not prepare PR checkout: auth denied/);
    expect(res.repos[0].cloned).toBe(false);
    expect(res.ci).toBeUndefined();
  });

  it('surfaces a give-up state (exhausted) from the CI-loop', async () => {
    const git = fakeGit();
    const agent: AgentInvoker = { run: vi.fn(async () => {}) };
    // Always failing; maxIterations=1 → one fix, still red → exhausted.
    const forge = scriptedForge([[{ name: 'build', status: 'completed', conclusion: 'failure' }]]);
    const res = await runFixPr({ ...cfg, maxIterations: 1 }, { git, agent, forge, tokenSource, sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(res.ci?.state).toBe('exhausted');
    expect(res.repos[0].error).toBe('ci-loop: exhausted');
    expect(forge.comments.length).toBe(1); // best-effort give-up comment on the PR
  });
});
