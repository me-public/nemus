import { describe, it, expect } from 'vitest';
import {
  normalizeErrorSignature,
  isCorrectionPrompt,
  analyzeCorpus,
  buildAnalysisPrompt,
} from './reflect-analyze';
import { ReflectionCorpus } from './reflect';

describe('normalizeErrorSignature', () => {
  it('collapses paths, numbers, and hashes so variants cluster', () => {
    const a = normalizeErrorSignature('fatal: not a git repository (or any parent up to /Users/alice/work/repo)');
    const b = normalizeErrorSignature('fatal: not a git repository (or any parent up to /home/bob/src/thing)');
    expect(a).toBe(b);
    expect(a).toContain('<path>');

    expect(normalizeErrorSignature('exit code 137 after 4200ms')).toBe(
      normalizeErrorSignature('exit code 2 after 9ms'),
    );
    expect(normalizeErrorSignature('object abc1234def not found')).toBe(
      normalizeErrorSignature('object 0f9e8d7c6b not found'),
    );
  });

  it('is bounded and safe on empty input', () => {
    expect(normalizeErrorSignature('')).toBe('');
    expect(normalizeErrorSignature('x'.repeat(500)).length).toBeLessThanOrEqual(100);
  });
});

describe('isCorrectionPrompt', () => {
  it('flags corrections, not normal instructions', () => {
    expect(isCorrectionPrompt('no, that is wrong — revert it')).toBe(true);
    expect(isCorrectionPrompt('actually use the other repo instead')).toBe(true);
    expect(isCorrectionPrompt('you forgot to run the tests')).toBe(true);
    expect(isCorrectionPrompt('add a health check to the api')).toBe(false);
    expect(isCorrectionPrompt('create a workspace for payments')).toBe(false);
  });
});

const corpus: ReflectionCorpus = {
  generatedAt: 'now',
  availableSkills: ['redash'],
  workspaces: [
    {
      name: 'pay-app',
      repoCount: 1,
      repos: ['api'],
      contextFiles: ['AGENTS.md'],
      session: {
        sessionId: 's1',
        agentType: 'pi',
        turns: 40,
        userPrompts: ['fix the sync bug', 'no that is wrong, revert'],
        errors: [
          'fatal: not a git repository (at /Users/a/pay-app/api)',
          'fatal: not a git repository (at /Users/a/pay-app/web)',
          'gh: Not Found (HTTP 404)',
        ],
        tools: ['bash', 'edit'],
      },
    },
    {
      name: 'ledger',
      repoCount: 0,
      repos: [],
      contextFiles: [], // missing context
      session: {
        sessionId: 's2',
        agentType: 'pi',
        turns: 12,
        userPrompts: ['add tests'],
        errors: ['fatal: not a git repository (at /home/b/ledger)'],
        tools: ['bash'],
      },
    },
    { name: 'idle-ws', repoCount: 0, repos: [], contextFiles: ['CLAUDE.md'], session: null },
  ],
};

describe('analyzeCorpus', () => {
  const a = analyzeCorpus(corpus);

  it('aggregates totals and correction signals', () => {
    expect(a.totalWorkspaces).toBe(3);
    expect(a.sessionsAnalyzed).toBe(2); // idle-ws has no session
    expect(a.totalTurns).toBe(52);
    expect(a.correctionSignals).toBe(1); // "no that is wrong, revert"
  });

  it('clusters the recurring failure across workspaces, most frequent first', () => {
    const top = a.topErrors[0];
    expect(top.signature).toContain('not a git repository');
    expect(top.count).toBe(3); // 2 in pay-app + 1 in ledger
    expect(top.workspaces.sort()).toEqual(['ledger', 'pay-app']);
    expect(top.example).toContain('fatal: not a git repository');
  });

  it('reports tools, missing-context, and per-workspace facts', () => {
    expect(a.topTools[0]).toEqual({ tool: 'bash', sessions: 2 });
    expect(a.workspacesMissingContext).toEqual(['ledger']);
    const pay = a.workspaces.find((w) => w.name === 'pay-app')!;
    expect(pay).toMatchObject({ turns: 40, failures: 3, hasContext: true });
    expect(pay.topFailure).toContain('not a git repository');
    expect(a.workspaces.find((w) => w.name === 'idle-ws')).toMatchObject({ turns: 0, failures: 0 });
  });
});

describe('buildAnalysisPrompt', () => {
  it('is compact and fact-based (no raw transcripts)', () => {
    const p = buildAnalysisPrompt(analyzeCorpus(corpus));
    expect(p).toContain('A script has already analyzed');
    expect(p).toContain('Sessions analyzed: 2 across 3 workspaces (52 total turns).');
    expect(p).toContain('Top recurring failures');
    expect(p).toMatch(/\[3\u00d7 in 2 ws\]/); // the clustered failure
    expect(p).toContain('missing a context file (AGENTS.md/CLAUDE.md): ledger');
    expect(p).toContain('bash(2)');
    expect(p).toMatch(/ONLY a JSON object/);
    // Compact: even this corpus stays well under a few KB.
    expect(p.length).toBeLessThan(3000);
  });
});
