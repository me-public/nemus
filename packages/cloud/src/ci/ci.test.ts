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
  const notes: string[] = [];
  const deps: CiLoopDeps = {
    forge, git, agent, sleep: async () => {}, log: (s) => events.push(`log:${s}`),
    notifier: { id: 'test', notify: async (n) => { notes.push(n.event); } },
  };
  const config: CiLoopConfig = {
    repo: { owner: 'acme', repo: 'api' },
    prNumber: 7,
    branch: 'nemus/x',
    workdir: '/w',
    agent: 'pi',
    maxIterations: 2,
    maxPollsPerIteration: 3,
  };
  return { deps, config, events, comments, notes, agentCalls: () => events.filter((e) => e === 'agent').length };
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

  it('a check that appears but never completes → timeout (+ comment)', async () => {
    const { deps, config, comments } = harness([[running('build')]]); // perpetually pending
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: false, state: 'timeout' });
    expect(comments).toHaveLength(1);
  });

  it('a ref with NO CI at all → no_checks (ok, no give-up comment or notification)', async () => {
    const { deps, config, comments, notes } = harness([[]]); // no check ever appears
    const r = await runCiLoop(config, deps);
    expect(r).toMatchObject({ ok: true, state: 'no_checks' });
    expect(comments).toEqual([]); // never a false "needs a human"
    expect(notes).toEqual([]); // and nothing worth pinging about
  });

  it('notifies ci_green on success and needs_human on give-up', async () => {
    const green = harness([[done('build', 'success')]]);
    await runCiLoop(green.config, green.deps);
    expect(green.notes).toEqual(['ci_green']);

    const giveup = harness([[done('build', 'failure')]]); // exhausts
    await runCiLoop(giveup.config, giveup.deps);
    expect(giveup.notes).toEqual(['needs_human']);
  });

  it('a failing notifier is logged, never fatal to the loop', async () => {
    const h = harness([[done('build', 'success')]]);
    h.deps.notifier = { id: 'bad', notify: async () => { throw new Error('webhook 500'); } };
    const r = await runCiLoop(h.config, h.deps); // must still return green
    expect(r.state).toBe('green');
    expect(h.events.some((e) => e.startsWith('log:notify failed: webhook 500'))).toBe(true);
  });
});
