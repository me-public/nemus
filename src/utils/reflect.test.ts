import { describe, it, expect } from 'vitest';
import { distillTranscript, parseReflectionReport, classifyAgentsMd, isCorrectionPrompt, saveReflectionReport } from './reflect';
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
