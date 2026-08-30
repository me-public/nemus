import { describe, it, expect } from 'vitest';
import { parseAgentJson, runAgentRaw, runAgentRawAsync, agentAttempts } from './agent-judge';

describe('parseAgentJson', () => {
  it('unwraps the common agent envelopes and shapes', () => {
    expect(parseAgentJson('{"a":1}')).toEqual({ a: 1 }); // bare object
    expect(parseAgentJson(J({ structured_output: { a: 2 } }))).toEqual({ a: 2 }); // claude structured
    expect(parseAgentJson(J({ result: J({ a: 3 }) }))).toEqual({ a: 3 }); // result-as-json-string
    expect(parseAgentJson(J({ result: { a: 4 } }))).toEqual({ a: 4 }); // result-as-object
    expect(parseAgentJson('```json\n{"a":5}\n```')).toEqual({ a: 5 }); // fenced
    expect(parseAgentJson('noise before {"a":6} after')).toEqual({ a: 6 }); // outermost span fallback
  });

  it('throws when there is no JSON at all', () => {
    expect(() => parseAgentJson('totally not json')).toThrow(/did not return JSON/);
  });
});

describe('agentAttempts', () => {
  it('claude: preferred (schema + lean flags) then a plain fallback', () => {
    const a = agentAttempts('claude', 'P', '{"type":"object"}');
    expect(a[0]).toEqual({ cmd: 'claude', args: expect.arrayContaining(['-p', 'P', '--output-format', 'json', '--json-schema', '{"type":"object"}']) });
    expect(a[1]).toEqual({ cmd: 'claude', args: ['-p', 'P'] });
  });
  it('pi: lean then plain; opencode: single run', () => {
    const pi = agentAttempts('pi', 'P');
    expect(pi[0].args).toEqual(expect.arrayContaining(['--no-tools', '--no-skills', '-p', 'P']));
    expect(pi[1]).toEqual({ cmd: 'pi', args: ['-p', 'P'] });
    expect(agentAttempts('opencode', 'P')).toEqual([{ cmd: 'opencode', args: ['run', 'P'] }]);
  });
});

describe('runAgentRawAsync', () => {
  it('runs the preferred attempt and returns stdout', async () => {
    const calls: string[][] = [];
    const execAsync = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return '{"ok":true}';
    };
    const out = await runAgentRawAsync('P', { agentType: 'pi', execAsync });
    expect(out).toBe('{"ok":true}');
    expect(calls).toHaveLength(1); // first attempt succeeded, no fallback
  });

  it('turns a timeout into an actionable error', async () => {
    const execAsync = async () => {
      throw Object.assign(new Error('spawn pi ETIMEDOUT'), { code: 'ETIMEDOUT', killed: true });
    };
    await expect(runAgentRawAsync('P', { agentType: 'pi', execAsync })).rejects.toThrow(/timed out.*NEMUS_JUDGE_TIMEOUT_MS/s);
  });
});

describe('runAgentRaw', () => {
  it('claude: passes the schema + lean flags, falls back on a rejected flag', () => {
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (calls.length === 1) throw new Error('unknown flag --json-schema'); // old claude
      return '{"ok":true}';
    };
    const out = runAgentRaw('PROMPT', { agentType: 'claude', schema: '{"type":"object"}', exec });
    expect(out).toBe('{"ok":true}');
    // first (preferred) attempt carries the schema + structured flags…
    expect(calls[0]).toEqual(expect.arrayContaining(['claude', '-p', 'PROMPT', '--output-format', 'json', '--json-schema', '{"type":"object"}']));
    // …the fallback is the plainest form
    expect(calls[1]).toEqual(['claude', '-p', 'PROMPT']);
  });

  it('pi: runs with lean flags', () => {
    let seen: string[] = [];
    const exec = (cmd: string, args: string[]) => {
      seen = [cmd, ...args];
      return 'ok';
    };
    runAgentRaw('P', { agentType: 'pi', exec });
    expect(seen).toEqual(expect.arrayContaining(['pi', '--no-extensions', '--no-skills', '--no-tools', '-p', 'P']));
  });

  it('wraps a hard failure in a clear error', () => {
    const exec = () => { throw Object.assign(new Error('boom'), { stderr: 'agent exploded' }); };
    // pi retries once (lean → plain), then throws
    expect(() => runAgentRaw('P', { agentType: 'pi', exec })).toThrow(/agent judge failed \(pi\): agent exploded/);
  });
});

function J(o: unknown) {
  return JSON.stringify(o);
}
