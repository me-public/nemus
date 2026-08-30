import { describe, it, expect } from 'vitest';
import { parseAgentJson, runAgentRaw } from './agent-judge';

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
