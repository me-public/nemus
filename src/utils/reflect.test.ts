import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { distillTranscript, parseReflectionReport, classifyAgentsMd, isCorrectionPrompt, saveReflectionReport, severityCounts, severitySummary, renderReportMarkdown, groupRecommendations, listSavedReports, loadSavedReport, REFLECT_REPORTS_DIR, ReflectionReport, Recommendation } from './reflect';
import * as fs from 'fs/promises';
import * as path from 'path';

const J = (o: unknown) => JSON.stringify(o);

describe('distillTranscript', () => {
  it('extracts prompts, tools, errors, and turns across pi + claude shapes', () => {
    const lines = [
      'not json — skipped',
      // pi: user prompt
      J({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } }),
      // pi: assistant with a toolCall
      J({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] } }),
      // pi: tool result flagged as error
      J({ type: 'message', message: { role: 'toolResult', toolName: 'bash', isError: true, content: [{ type: 'text', text: 'command failed: boom' }] } }),
      // claude: user prompt as plain string
      J({ type: 'user', message: { role: 'user', content: 'claude style prompt' } }),
      // a correction/re-steer → captured verbatim in reSteerSamples
      J({ type: 'user', message: { role: 'user', content: 'no, that is wrong — revert that change' } }),
      // claude: assistant tool_use
      J({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }] } }),
      // claude: tool_result-only user message → an error, NOT a prompt
      J({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'file not found' }] } }),
      // a system-reminder-style user text → ignored as a prompt
      J({ type: 'message', message: { role: 'user', content: '<system-reminder>ignore me</system-reminder>' } }),
      // UNFLAGGED benign result whose text merely mentions "error" → NOT a failure
      J({ type: 'message', message: { role: 'toolResult', toolName: 'grep', content: [{ type: 'text', text: '0 results for error' }] } }),
      // UNFLAGGED result with a strong failure signal → a failure (regex fallback)
      J({ type: 'message', message: { role: 'toolResult', toolName: 'git', content: [{ type: 'text', text: 'fatal: not a git repository' }] } }),
      // EXPLICITLY not-an-error, despite failing-looking text → trust the flag
      J({ type: 'message', message: { role: 'toolResult', isError: false, content: [{ type: 'text', text: 'fatal: boom (but flagged success)' }] } }),
    ].join('\n');

    const d = distillTranscript(lines, { sessionId: 's1', agentType: 'pi' });
    expect(d.turns).toBe(2);
    expect(d.userPrompts).toEqual(['do the thing', 'claude style prompt', 'no, that is wrong — revert that change']);
    expect(d.tools.sort()).toEqual(['Edit', 'bash', 'git', 'grep']);
    expect(d.errors).toContain('command failed: boom'); // explicit isError:true
    expect(d.errors).toContain('file not found'); // explicit is_error:true
    expect(d.errors).toContain('fatal: not a git repository'); // unflagged + strong signal
    expect(d.errors).not.toContain('0 results for error'); // unflagged benign 'error' mention
    expect(d.errors.some((e) => e.includes('flagged success'))).toBe(false); // isError:false trusted
    expect(d.reSteerSamples).toEqual(['no, that is wrong — revert that change']); // captured verbatim
  });

  it('is bounded and tolerant of empty input', () => {
    expect(distillTranscript('', { sessionId: 's', agentType: 'pi' })).toMatchObject({
      turns: 0,
      userPrompts: [],
      errors: [],
      tools: [],
    });
  });
});

describe('saveReflectionReport', () => {
  it('writes a timestamped JSON report (sanitized scope) and returns its path', async () => {
    const file = await saveReflectionReport(
      { summary: 'ok', recommendations: [{ kind: 'skill', title: 't', detail: 'd', priority: 'high' }] },
      { analyzed: 2, workspaces: 3, workspace: 'pay/app' },
    );
    try {
      expect(file).toMatch(/\.json$/);
      expect(path.basename(file)).toContain('pay_app'); // scope suffix, path-sanitized
      const written = JSON.parse(await fs.readFile(file, 'utf-8'));
      expect(written).toMatchObject({ analyzed: 2, workspaces: 3, workspace: 'pay/app', summary: 'ok' });
      expect(written.generatedAt).toBeTruthy();
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});

describe('classifyAgentsMd', () => {
  it('distinguishes missing / boilerplate / substantive', () => {
    expect(classifyAgentsMd('')).toBe('missing');
    expect(classifyAgentsMd(null)).toBe('missing');
    // Generated template: headings + markers, little real guidance.
    expect(classifyAgentsMd('# Workspace\n\nThis workspace was created with Workspace Manager.\n<!-- ws-rules:v2 -->\n## Notes\n- \n')).toBe('boilerplate');
    // Real, rule-heavy content.
    const real = Array.from({ length: 12 }, (_, i) => `- Always run the ${i} integration suite before opening a pull request here`).join('\n');
    expect(classifyAgentsMd(`# Rules\n${real}`)).toBe('substantive');
  });

  it('is newline-independent: a whitespace-collapsed substantive file still classifies substantive', () => {
    // Regression for the collapse bug: same content, newlines squashed to spaces.
    const real = Array.from({ length: 12 }, (_, i) => `- Always run the ${i} integration suite before opening a pull request here`).join('\n');
    const multiline = `# Rules\n${real}`;
    const collapsed = multiline.replace(/\s+/g, ' ');
    expect(classifyAgentsMd(collapsed)).toBe(classifyAgentsMd(multiline));
    expect(classifyAgentsMd(collapsed)).toBe('substantive');
  });
});

describe('isCorrectionPrompt', () => {
  it('flags corrections, not normal instructions', () => {
    expect(isCorrectionPrompt('no, revert that')).toBe(true);
    expect(isCorrectionPrompt('actually use the other repo instead')).toBe(true);
    expect(isCorrectionPrompt('add a health check to the api')).toBe(false);
  });
});

describe('parseReflectionReport', () => {
  it('normalizes, clamps enums, and drops empty recs', () => {
    const report = parseReflectionReport({
      summary: 'ok',
      recommendations: [
        { kind: 'skill', title: 'Add X', detail: 'because Y', priority: 'high', target: ' api ', example: 'stub' },
        { kind: 'bogus', title: 'clamp me', detail: 'd', priority: 'urgent' }, // kind→other, priority→medium
        { title: '', detail: '' }, // dropped
        'garbage', // dropped
      ],
    });
    expect(report.summary).toBe('ok');
    expect(report.recommendations).toHaveLength(2);
    expect(report.recommendations[0]).toEqual({ kind: 'skill', title: 'Add X', detail: 'because Y', priority: 'high', target: 'api', example: 'stub' });
    expect(report.recommendations[1]).toMatchObject({ kind: 'other', priority: 'medium', title: 'clamp me' });
  });

  it('tolerates a malformed top-level object', () => {
    expect(parseReflectionReport(null)).toEqual({ summary: '', recommendations: [] });
    expect(parseReflectionReport({ recommendations: 'nope' })).toEqual({ summary: '', recommendations: [] });
  });
});

describe('severityCounts / severitySummary', () => {
  const recs = (ps: Array<'high' | 'medium' | 'low'>) =>
    ps.map((priority) => ({ kind: 'other' as const, title: 't', detail: 'd', priority }));

  it('counts by priority', () => {
    expect(severityCounts(recs(['high', 'high', 'low']))).toEqual({ high: 2, medium: 0, low: 1 });
  });
  it('summary omits empty buckets and is empty for none', () => {
    expect(severitySummary(recs(['high', 'medium', 'medium']))).toBe('1 high · 2 medium');
    expect(severitySummary([])).toBe('');
  });
});

describe('renderReportMarkdown', () => {
  const report: ReflectionReport = {
    summary: 'Overall fine.',
    recommendations: [
      { kind: 'skill', title: 'Add deploy skill', detail: 'manual steps', priority: 'high', target: 'acme/api', example: 'name: deploy' },
      { kind: 'context', title: 'Doc lint', detail: 'guessed', priority: 'medium' },
    ],
  };

  it('groups by severity with a count line and headings', () => {
    const md = renderReportMarkdown(report, { analyzed: 5, workspaces: 3, generatedAt: '2026-09-01T12:00:00Z' });
    expect(md).toMatch(/^# Reflection/);
    expect(md).toContain('_5 sessions across 3 workspaces · 2026-09-01T12:00:00Z_');
    expect(md).toContain('**1 high · 1 medium**');
    expect(md).toContain('### High priority');
    expect(md).toContain('### Medium priority');
    // high appears before medium
    expect(md.indexOf('### High priority')).toBeLessThan(md.indexOf('### Medium priority'));
    expect(md).toContain('- **[Skill] Add deploy skill** (`acme/api`)');
    expect(md).toContain('- **[Context/AGENTS.md] Doc lint**');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('uses a single-workspace scope line', () => {
    const md = renderReportMarkdown(report, { analyzed: 1, workspaces: 1, workspace: 'my-ws' });
    expect(md).toContain('_workspace **my-ws**_');
  });

  it('escapes an example that itself contains a triple-backtick fence', () => {
    const r: ReflectionReport = {
      summary: '',
      recommendations: [{ kind: 'other', title: 'x', detail: '', priority: 'low', example: 'a ```b``` c' }],
    };
    const md = renderReportMarkdown(r, { analyzed: 1, workspaces: 1 });
    expect(md).toContain('````'); // fence longer than the inner run
    expect(md).toContain('a ```b``` c');
  });

  it('renders a clean empty state', () => {
    const md = renderReportMarkdown({ summary: 'All good.', recommendations: [] }, { analyzed: 2, workspaces: 2 });
    expect(md).toContain('_No specific recommendations — looks solid._');
    expect(md).not.toContain('### High');
  });
});

describe('groupRecommendations', () => {
  const mk = (kind: Recommendation['kind'], priority: Recommendation['priority'], title = 't'): Recommendation =>
    ({ kind, title, detail: 'd', priority });

  it('groups by priority (high→low), omitting empty groups', () => {
    const groups = groupRecommendations([mk('skill', 'low'), mk('context', 'high')], 'priority');
    expect(groups.map((g) => g.key)).toEqual(['high', 'low']); // no 'medium'
    expect(groups[0].heading).toBe('High priority');
  });

  it('groups by kind in a fixed order, priority-sorted within a kind', () => {
    const groups = groupRecommendations(
      [mk('context', 'low'), mk('skill', 'low', 'a'), mk('skill', 'high', 'b')],
      'kind',
    );
    expect(groups.map((g) => g.key)).toEqual(['skill', 'context']); // skill before context
    expect(groups[0].recs.map((r) => r.title)).toEqual(['b', 'a']); // high before low within skill
  });
});

describe('listSavedReports / loadSavedReport', () => {
  const older = path.join(REFLECT_REPORTS_DIR, '2000-01-01T00-00-00-000Z-vitestA.json');
  const newer = path.join(REFLECT_REPORTS_DIR, '2000-01-02T00-00-00-000Z-vitestB.json');
  const idOf = (f: string) => path.basename(f).replace(/\.json$/, '');

  beforeAll(async () => {
    await fs.mkdir(REFLECT_REPORTS_DIR, { recursive: true });
    await fs.writeFile(older, JSON.stringify({ generatedAt: '2000-01-01T00:00:00.000Z', analyzed: 4, workspaces: 3, summary: 'old', recommendations: [{ kind: 'skill', title: 'x', detail: 'd', priority: 'high' }] }));
    await fs.writeFile(newer, JSON.stringify({ generatedAt: '2000-01-02T00:00:00.000Z', analyzed: 1, workspaces: 1, workspace: 'ws', summary: 'new', recommendations: [] }));
  });
  afterAll(async () => {
    await fs.rm(older, { force: true });
    await fs.rm(newer, { force: true });
  });

  it('lists my fixtures newest-first', async () => {
    const all = await listSavedReports();
    const ids = all.map((r) => r.id).filter((id) => id.endsWith('vitestA') || id.endsWith('vitestB'));
    expect(ids).toEqual([idOf(newer), idOf(older)]); // newer before older
    const b = all.find((r) => r.id === idOf(newer))!;
    expect(b.workspace).toBe('ws');
    expect(b.report.recommendations).toHaveLength(0);
  });

  it('loadSavedReport resolves latest, exact id, and prefix', async () => {
    const latest = await loadSavedReport('latest');
    // "latest" is global; assert it parsed a report rather than a specific id.
    expect(latest?.report).toBeDefined();
    const exact = await loadSavedReport(idOf(older));
    expect(exact?.workspaces).toBe(3);
    const byPrefix = await loadSavedReport('2000-01-02T00-00-00');
    expect(byPrefix?.id).toBe(idOf(newer));
    expect(await loadSavedReport('definitely-no-such-id-xyz')).toBeNull();
  });
});
