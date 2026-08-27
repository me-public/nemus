import { describe, it, expect, vi } from 'vitest';
import { parseAgentEnv, parseRepo } from './env';
import { runAgentTask, slug, RunAgentDeps } from './run';
import { AgentRunConfig, GitOps } from './types';
import { ForgeTokenSource } from '../forge/types';
import { GitForge } from '../gitforge/types';

describe('parseAgentEnv', () => {
  it('parses the contract with defaults', () => {
    const c = parseAgentEnv({ NEMUS_REPOS: 'acme/api, web ', NEMUS_TASK: 'do it', NEMUS_OWNER: 'acme' });
    expect(c.repos).toEqual(['acme/api', 'web']);
    expect(c).toMatchObject({
      task: 'do it',
      agent: 'pi',
      gitHost: 'github.com',
      owner: 'acme',
      baseBranch: 'main',
      branchPrefix: 'nemus/',
      workdir: '/workspace',
      report: 'pr',
      draft: true,
    });
  });

  it('honors overrides', () => {
    const c = parseAgentEnv({
      NEMUS_REPOS: 'x',
      NEMUS_TASK: 't',
      NEMUS_AGENT: 'claude',
      GIT_HOST: 'ghe.acme.com',
      REPORT_MODE: 'none',
      NEMUS_PR_DRAFT: '0',
      NEMUS_BASE_BRANCH: 'develop',
    });
    expect(c).toMatchObject({ agent: 'claude', gitHost: 'ghe.acme.com', report: 'none', draft: false, baseBranch: 'develop' });
  });

  it('requires repos + task and validates REPORT_MODE', () => {
    expect(() => parseAgentEnv({ NEMUS_TASK: 't' })).toThrow(/NEMUS_REPOS is required/);
    expect(() => parseAgentEnv({ NEMUS_REPOS: 'x' })).toThrow(/NEMUS_TASK is required/);
    expect(() => parseAgentEnv({ NEMUS_REPOS: 'x', NEMUS_TASK: 't', REPORT_MODE: 'slack' })).toThrow(/REPORT_MODE/);
  });
});

describe('parseRepo', () => {
  it('handles owner/name, bare+default, and .git suffix', () => {
    expect(parseRepo('acme/api').full).toBe('acme/api');
    expect(parseRepo('api', 'acme').full).toBe('acme/api');
    expect(parseRepo('acme/api.git').name).toBe('api');
    expect(() => parseRepo('api')).toThrow(/no owner/);
  });
});

describe('slug', () => {
  it('makes a safe branch slug', () => {
    expect(slug('Add /healthz endpoint to the API!')).toBe('add-healthz-endpoint-to-the-api');
    expect(slug('   ')).toBe('task');
  });
});

// --- orchestrator ----------------------------------------------------------

const baseConfig: AgentRunConfig = {
  repos: ['acme/api', 'acme/web'],
  task: 'add idempotency keys',
  agent: 'pi',
  gitHost: 'github.com',
  owner: 'acme',
  baseBranch: 'main',
  branchPrefix: 'nemus/',
  workdir: '/workspace',
  report: 'pr',
  draft: true,
};

function fakeGit(overrides: Partial<GitOps> = {}): GitOps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clone: vi.fn(async (url, dir) => { calls.push(`clone ${dir}`); }),
    checkoutNewBranch: vi.fn(async (dir, b) => { calls.push(`branch ${dir} ${b}`); }),
    hasChanges: vi.fn(async () => true),
    commitAll: vi.fn(async (dir) => { calls.push(`commit ${dir}`); }),
    push: vi.fn(async (dir, b) => { calls.push(`push ${dir} ${b}`); }),
    ...overrides,
  } as any;
}

const tokenSource: ForgeTokenSource = {
  id: 't',
  getToken: vi.fn(async () => ({ token: 'ghs_x', expiresAt: new Date('2030-01-01') })),
};

function fakeForge(): GitForge & { opened: any[] } {
  const opened: any[] = [];
  return {
    id: 'github',
    opened,
    openPR: vi.fn(async (i: any) => {
      opened.push(i);
      return { number: opened.length, url: `https://github.com/${i.owner}/${i.repo}/pull/${opened.length}`, state: 'open' as const };
    }),
    getChecks: vi.fn(async () => []),
    comment: vi.fn(async () => undefined),
  } as any;
}

describe('runAgentTask', () => {
  it('clones, runs the agent once, and opens a PR per changed repo', async () => {
    const git = fakeGit();
    const forge = fakeForge();
    const agent = { run: vi.fn(async () => undefined) };
    const deps: RunAgentDeps = { git, agent, forge, tokenSource };

    const res = await runAgentTask(baseConfig, deps);

    expect(res.ok).toBe(true);
    expect(agent.run).toHaveBeenCalledTimes(1); // ONCE over the whole workspace
    expect(agent.run).toHaveBeenCalledWith({ workdir: '/workspace', task: baseConfig.task, agent: 'pi' });
    expect(res.repos.map((r) => r.repo)).toEqual(['acme/api', 'acme/web']);
    expect(res.repos.every((r) => r.cloned && r.changed && r.pushed && r.prUrl)).toBe(true);
    expect(forge.opened).toHaveLength(2);
    // least-privilege token scoped to the repos
    expect(tokenSource.getToken).toHaveBeenCalledWith({
      repos: ['acme/api', 'acme/web'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    // authed clone URL carries the token
    expect((git.clone as any).mock.calls[0][0]).toContain('x-access-token:ghs_x@github.com/acme/api.git');
  });

  it('skips repos with no changes (no push, no PR)', async () => {
    const git = fakeGit({ hasChanges: vi.fn(async (dir: string) => dir.endsWith('api')) as any });
    const forge = fakeForge();
    const deps: RunAgentDeps = { git, agent: { run: vi.fn(async () => undefined) }, forge, tokenSource };

    const res = await runAgentTask(baseConfig, deps);
    const web = res.repos.find((r) => r.repo === 'acme/web')!;
    expect(web.changed).toBe(false);
    expect(web.pushed).toBeUndefined();
    expect(forge.opened).toHaveLength(1); // only api
    expect(res.ok).toBe(true);
  });

  it('report=none pushes but opens no PR', async () => {
    const forge = fakeForge();
    const deps: RunAgentDeps = { git: fakeGit(), agent: { run: vi.fn(async () => undefined) }, forge, tokenSource };
    const res = await runAgentTask({ ...baseConfig, report: 'none' }, deps);
    expect(res.repos.every((r) => r.pushed)).toBe(true);
    expect(forge.opened).toHaveLength(0);
  });

  it('isolates a per-repo failure and marks the run not ok', async () => {
    const git = fakeGit({
      push: vi.fn(async (dir: string) => { if (dir.endsWith('web')) throw new Error('push rejected'); }) as any,
    });
    const forge = fakeForge();
    const deps: RunAgentDeps = { git, agent: { run: vi.fn(async () => undefined) }, forge, tokenSource };
    const res = await runAgentTask(baseConfig, deps);
    expect(res.ok).toBe(false);
    expect(res.repos.find((r) => r.repo === 'acme/api')!.prUrl).toBeTruthy();
    expect(res.repos.find((r) => r.repo === 'acme/web')!.error).toMatch(/push rejected/);
  });

  it('aborts with a top-level error if the agent fails', async () => {
    const deps: RunAgentDeps = {
      git: fakeGit(),
      agent: { run: vi.fn(async () => { throw new Error('bedrock timeout'); }) },
      forge: fakeForge(),
      tokenSource,
    };
    const res = await runAgentTask(baseConfig, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/agent run failed: bedrock timeout/);
  });

  it('reports "no repositories cloned" when every clone fails', async () => {
    const git = fakeGit({ clone: vi.fn(async () => { throw new Error('auth failed'); }) as any });
    const deps: RunAgentDeps = { git, agent: { run: vi.fn(async () => undefined) }, forge: fakeForge(), tokenSource };
    const res = await runAgentTask(baseConfig, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no repositories were cloned/);
    expect(res.repos.every((r) => r.error === 'auth failed')).toBe(true);
  });
});
