import { describe, it, expect } from 'vitest';
import { distillTranscript, parseReflectionReport } from './reflect';

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
    expect(d.userPrompts).toEqual(['do the thing', 'claude style prompt']);
    expect(d.tools.sort()).toEqual(['Edit', 'bash', 'git', 'grep']);
    expect(d.errors).toContain('command failed: boom'); // explicit isError:true
    expect(d.errors).toContain('file not found'); // explicit is_error:true
    expect(d.errors).toContain('fatal: not a git repository'); // unflagged + strong signal
    expect(d.errors).not.toContain('0 results for error'); // unflagged benign 'error' mention
    expect(d.errors.some((e) => e.includes('flagged success'))).toBe(false); // isError:false trusted
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
