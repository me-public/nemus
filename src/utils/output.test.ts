import { describe, it, expect, vi, afterEach } from 'vitest';
import { outputJson, outputJsonError } from './output';

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe('outputJson', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes exactly one pretty JSON document + trailing newline to stdout', () => {
    const { calls, restore } = captureStdout();
    outputJson({ a: 1, b: ['x', 'y'] });
    restore();
    expect(calls).toHaveLength(1);
    expect(calls[0].endsWith('\n')).toBe(true);
    expect(calls[0]).toBe(JSON.stringify({ a: 1, b: ['x', 'y'] }, null, 2) + '\n');
    expect(JSON.parse(calls[0])).toEqual({ a: 1, b: ['x', 'y'] });
  });
});

describe('outputJsonError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits a parseable { ok:false, error } object to stdout', () => {
    const { calls, restore } = captureStdout();
    outputJsonError('boom');
    restore();
    expect(JSON.parse(calls[0])).toEqual({ ok: false, error: 'boom' });
  });
});
