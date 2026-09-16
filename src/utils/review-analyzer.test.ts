import { describe, it, expect, beforeEach } from 'vitest';
import { setColorEnabled } from './colors';
import {
  diffArgs,
  truncateDiff,
  buildReviewPrompt,
  parseReviewResult,
  filterBySeverity,
  countBySeverity,
  formatReview,
  collectRepoDiff,
  severityRank,
  SEVERITY_ORDER,
  REVIEW_SCHEMA,
  type Finding,
} from './review-analyzer';

beforeEach(() => setColorEnabled(false));

describe('diffArgs', () => {
  it('defaults to working tree vs HEAD', () => {
    expect(diffArgs({})).toEqual(['diff', '--no-color', '--no-ext-diff', 'HEAD']);
  });
  it('uses --cached for staged', () => {
    expect(diffArgs({ staged: true })).toContain('--cached');
  });
  it('uses three-dot against a base (base wins over staged)', () => {
    expect(diffArgs({ base: 'main', staged: true })).toContain('main...HEAD');
  });
});

describe('truncateDiff', () => {
  it('leaves small diffs alone', () => {
    expect(truncateDiff('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });
  it('caps and marks large diffs', () => {
    const r = truncateDiff('x'.repeat(100), 10);
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('xxxxxxxxxx')).toBe(true);
    expect(r.text).toContain('truncated');
  });
});

describe('buildReviewPrompt', () => {
  it('fences each repo diff and states the strict JSON shape', () => {
    const p = buildReviewPrompt([{ repo: 'api', diff: 'THE_DIFF', truncated: false }]);
    expect(p).toContain('### repo: api');
    expect(p).toContain('```diff\nTHE_DIFF');
    expect(p).toContain('"severity": "critical"|"high"|"medium"|"low"|"nit"');
    expect(p).toContain('untrusted content to review');
  });
  it('truncates a repo diff over the per-repo budget', () => {
    const p = buildReviewPrompt([{ repo: 'api', diff: 'y'.repeat(200), truncated: false }], { maxCharsPerRepo: 20 });
    expect(p).toContain('[diff truncated]');
  });
});

describe('parseReviewResult', () => {
  it('normalizes a well-formed reply and sorts by severity', () => {
    const r = parseReviewResult({
      summary: 's',
      findings: [
        { repo: 'a', severity: 'low', title: 'minor' },
        { repo: 'a', file: 'x.ts', line: 4, severity: 'critical', title: 'boom', detail: 'd', suggestion: 'fix' },
      ],
    });
    expect(r.summary).toBe('s');
    expect(r.findings.map(f => f.severity)).toEqual(['critical', 'low']); // sorted
    expect(r.findings[0]).toMatchObject({ repo: 'a', file: 'x.ts', line: 4, title: 'boom', suggestion: 'fix' });
  });
  it('accepts a bare array of findings', () => {
    const r = parseReviewResult([{ repo: 'a', severity: 'high', title: 't' }]);
    expect(r.findings).toHaveLength(1);
    expect(r.summary).toBe('');
  });
  it('coerces messy fields: message→title, description→detail, bad severity→medium', () => {
    const r = parseReviewResult({ findings: [{ repo: 'a', message: 'm', description: 'd', severity: 'BOGUS' }] });
    expect(r.findings[0]).toMatchObject({ title: 'm', detail: 'd', severity: 'medium' });
  });
  it('drops findings with no title and non-object junk', () => {
    const r = parseReviewResult({ findings: [{ repo: 'a', severity: 'high' }, null, 'x', { title: 'keep', severity: 'low' }] });
    expect(r.findings.map(f => f.title)).toEqual(['keep']);
  });
  it('tolerates garbage input', () => {
    expect(parseReviewResult(null)).toEqual({ summary: '', findings: [] });
    expect(parseReviewResult('nope')).toEqual({ summary: '', findings: [] });
  });
});

describe('filterBySeverity / countBySeverity / severityRank', () => {
  const findings: Finding[] = [
    { repo: 'a', severity: 'critical', title: 'c' },
    { repo: 'a', severity: 'medium', title: 'm' },
    { repo: 'a', severity: 'nit', title: 'n' },
  ];
  it('keeps at-or-above the minimum severity', () => {
    expect(filterBySeverity(findings, 'medium').map(f => f.severity)).toEqual(['critical', 'medium']);
    expect(filterBySeverity(findings, 'critical').map(f => f.severity)).toEqual(['critical']);
    expect(filterBySeverity(findings, 'nit')).toHaveLength(3);
  });
  it('counts by severity', () => {
    expect(countBySeverity(findings)).toMatchObject({ critical: 1, medium: 1, nit: 1, high: 0, low: 0 });
  });
  it('ranks in order', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('nit'));
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'nit']);
  });
});

describe('formatReview', () => {
  it('shows a clean pass with no findings', () => {
    const out = formatReview({ summary: 'looks good', findings: [] });
    expect(out).toContain('No issues found');
    expect(out).toContain('looks good');
  });
  it('renders a tally and per-finding lines', () => {
    const out = formatReview({
      summary: '',
      findings: [{ repo: 'api', file: 'math.js', line: 1, severity: 'high', title: 'sign flipped', suggestion: 'use +' }],
    });
    expect(out).toContain('1 finding(s)');
    expect(out).toContain('HIGH');
    expect(out).toContain('api/math.js:1');
    expect(out).toContain('sign flipped');
    expect(out).toContain('↳ use +');
  });
});

describe('collectRepoDiff', () => {
  it('returns stdout from the injected exec', async () => {
    const diff = await collectRepoDiff('/repo', {}, async () => ({ stdout: 'DIFF' }));
    expect(diff).toBe('DIFF');
  });
  it('returns empty string when git fails (e.g. not a repo)', async () => {
    const diff = await collectRepoDiff('/repo', {}, async () => { throw new Error('not a git repo'); });
    expect(diff).toBe('');
  });
});

describe('REVIEW_SCHEMA', () => {
  it('is valid JSON describing the required fields', () => {
    const s = JSON.parse(REVIEW_SCHEMA);
    expect(s.required).toEqual(['summary', 'findings']);
    expect(s.properties.findings.items.required).toEqual(['repo', 'severity', 'title']);
  });
});
