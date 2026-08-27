import { describe, it, expect } from 'vitest';
import { summarizeChecks, buildFixPrompt, buildGiveUpComment } from './checks';
import { runCiLoop } from './loop';
import { CiLoopConfig, CiLoopDeps } from './types';
import { CheckRun, GitForge } from '../gitforge/types';
import { AgentInvoker, GitOps } from '../agent/types';

const done = (name: string, conclusion: CheckRun['conclusion']): CheckRun => ({ name, status: 'completed', conclusion });
const running = (name: string): CheckRun => ({ name, status: 'in_progress', conclusion: null });

describe('summarizeChecks', () => {
  it('empty = pending (never a false green)', () => {
    expect(summarizeChecks([])).toMatchObject({ pending: true, green: false });
  });
  it('all completed + no failures = green', () => {
    expect(summarizeChecks([done('a', 'success'), done('b', 'skipped'), done('c', 'neutral')]).green).toBe(true);
  });
  it('a failure short-circuits waiting even if others run', () => {
    const s = summarizeChecks([running('a'), done('b', 'failure')]);
    expect(s.pending).toBe(false);
    expect(s.green).toBe(false);
    expect(s.failed.map((f) => f.name)).toEqual(['b']);
  });
  it('still-running with no failures = pending', () => {
    expect(summarizeChecks([running('a'), done('b', 'success')]).pending).toBe(true);
  });
});

describe('buildFixPrompt', () => {
  it('lists failing checks + threads the original task', () => {
    const p = buildFixPrompt({ task: 'add X' } as CiLoopConfig, [done('build', 'failure')]);
    expect(p).toContain('build (failure)');
    expect(p).toContain('Original task: add X');
  });
});

describe('buildGiveUpComment', () => {
  it('explains each terminal reason', () => {
    expect(buildGiveUpComment('exhausted', 3, [done('a', 'failure')])).toContain('after 3 automated fix');
    expect(buildGiveUpComment('stuck', 0, [])).toContain('no changes');
    expect(buildGiveUpComment('timeout', 1, [])).toContain('did not complete');
  });
});

// ---- loop harness ------------------------------------------------------------

function harness(checkSequence: CheckRun[][], opts: { agentChanges?: boolean } = {}) {
  let poll = 0;
  const events: string[] = [];
  const comments: string[] = [];
  const forge: GitForge = {
    id: 'github',
    openPR: async () => ({ number: 1, url: 'u', draft: true }) as any,
    getChecks: async () => {
      const idx = Math.min(poll, checkSequence.length - 1);
      poll++;
      return checkSequence[idx];
    },
    comment: async (i) => { comments.push(i.body); },
  };
  const git: GitOps = {
    clone: async () => {},
    checkoutNewBranch: async () => {},
    hasChanges: async () => opts.agentChanges ?? true,
    commitAll: async () => { events.push('commit'); },
    push: async () => { events.push('push'); },
  };
  const agent: AgentInvoker = { run: async () => { events.push('agent'); } };
  const deps: CiLoopDeps = { forge, git, agent, sleep: async () => {}, log: (s) => events.push(`log:${s}`) };
  const config: CiLoopConfig = {
    repo: { owner: 'acme', repo: 'api' },
    prNumber: 7,
    branch: 'nemus/x',
    workdir: '/w',
    agent: 'pi',
    maxIterations: 2,
    maxPollsPerIteration: 3,
  };
  return { deps, config, events, comments, agentCalls: () => events.filter((e) => e === 'agent').length };
}

describe('runCiLoop', () => {
  it('green immediately → no fix, no give-up comment', async () => {
    const { deps, config, agentCalls, comments } = harness([[done('build', 'success')]]);
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: true, state: 'green', iterations: 0 });
    expect(agentCalls()).toBe(0);
    expect(comments).toEqual([]);
  });

  it('waits through pending, then green', async () => {
    const { deps, config } = harness([[running('build')], [running('build')], [done('build', 'success')]]);
    const r = await runCiLoop(config, deps);
    expect(r.state).toBe('green');
  });

  it('failure → fix → green (one iteration)', async () => {
    const { deps, config, events, agentCalls } = harness([[done('build', 'failure')], [done('build', 'success')]]);
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: true, state: 'green', iterations: 1 });
    expect(agentCalls()).toBe(1);
    expect(events).toContain('commit');
    expect(events).toContain('push');
  });

  it('exhausts maxIterations while still failing + comments a give-up', async () => {
    const { deps, config, agentCalls, comments } = harness([[done('build', 'failure')]]); // always failing
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: false, state: 'exhausted', iterations: 2 });
    expect(agentCalls()).toBe(2);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain('needs a human');
    expect(comments[0]).toContain('- build');
  });

  it('a fix that changes nothing → stuck', async () => {
    const { deps, config, agentCalls } = harness([[done('build', 'failure')]], { agentChanges: false });
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: false, state: 'stuck', iterations: 0 });
    expect(agentCalls()).toBe(1);
  });

  it('checks never complete → timeout (also covers "no CI")', async () => {
    const { deps, config } = harness([[running('build')]]); // perpetually pending
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: false, state: 'timeout' });
  });

  it('empty checks are treated as pending → timeout, never green', async () => {
    const { deps, config } = harness([[]]);
    const r = await runCiLoop(config, deps);
    expect(r.state).toBe('timeout');
  });
});
