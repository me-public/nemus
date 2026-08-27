import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { OpenTofuProvisioner, parseTargetDescriptor } from './opentofu';
import { createProvisioner, provisionerNames, registerProvisioner } from './registry';
import { iacModuleDir } from './modules';
import { Exec, ExecResultRaw } from '../agent/exec';

function recorder(outputs: Record<string, ExecResultRaw> = {}) {
  const calls: { bin: string; args: string[] }[] = [];
  const exec: Exec = async (bin, args) => {
    calls.push({ bin, args });
    const cmd = args.find((a) => !a.startsWith('-')) ?? '';
    return outputs[cmd] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

const targetJson = JSON.stringify({
  target: { value: { version: 1, runner: 'aws-fargate', region: 'us-east-1', cluster: 'nemus', extra: { logGroup: '/nemus' } } },
  other: { value: 'ignored' },
});

describe('OpenTofuProvisioner.up', () => {
  it('runs init → apply → output with -chdir + vars, returns the descriptor', async () => {
    const { exec, calls } = recorder({ output: { code: 0, stdout: targetJson, stderr: '' } });
    const p = new OpenTofuProvisioner({ moduleDir: '/iac/fargate', vars: { region: 'us-east-1' }, exec });

    const target = await p.up({ app_name: 'demo', replicas: 2 });

    expect(calls.map((c) => c.args[1])).toEqual(['init', 'apply', 'output']); // subcommand is arg[1] after -chdir
    expect(calls[0].bin).toBe('tofu');
    expect(calls.every((c) => c.args[0] === '-chdir=/iac/fargate')).toBe(true);
    expect(calls.every((c) => c.args.includes('-input=false') && c.args.includes('-no-color'))).toBe(true);
    // apply carries -auto-approve + merged, stringified vars
    const apply = calls[1].args;
    expect(apply).toContain('-auto-approve');
    expect(apply).toContain('region=us-east-1');
    expect(apply).toContain('app_name=demo');
    expect(apply).toContain('replicas=2'); // non-string JSON-stringified
    expect(target).toEqual({ version: 1, runner: 'aws-fargate', region: 'us-east-1', cluster: 'nemus', extra: { logGroup: '/nemus' } });
  });

  it('down runs destroy with construction + handed-back vars', async () => {
    const { exec, calls } = recorder();
    const p = new OpenTofuProvisioner({ moduleDir: '/iac/fly', bin: 'terraform', vars: { org: 'acme' }, exec });
    await p.down({ version: 1, runner: 'fly', extra: { tofuVars: { app: 'demo' } } });
    expect(calls[0].bin).toBe('terraform');
    expect(calls[0].args[1]).toBe('destroy');
    expect(calls[0].args).toContain('-auto-approve');
    expect(calls[0].args).toContain('org=acme');
    expect(calls[0].args).toContain('app=demo');
  });

  it('requires a moduleDir', () => {
    expect(() => new OpenTofuProvisioner({ moduleDir: '' })).toThrow(/moduleDir/);
  });
});

describe('parseTargetDescriptor', () => {
  it('extracts and validates the named output', () => {
    expect(parseTargetDescriptor(targetJson).runner).toBe('aws-fargate');
  });
  it('throws when the output is missing', () => {
    expect(() => parseTargetDescriptor('{}')).toThrow(/no 'target' output/);
  });
  it('throws on a non-descriptor value', () => {
    expect(() => parseTargetDescriptor(JSON.stringify({ target: { value: { runner: 'x' } } }))).toThrow(/TargetDescriptor/);
    expect(() => parseTargetDescriptor(JSON.stringify({ target: { value: { version: 1 } } }))).toThrow(/TargetDescriptor/);
  });
  it('throws on unparseable json', () => {
    expect(() => parseTargetDescriptor('not json')).toThrow(/could not parse/);
  });
});

describe('provisioner registry', () => {
  it('ships opentofu + terraform', () => {
    expect(provisionerNames()).toEqual(expect.arrayContaining(['opentofu', 'terraform']));
  });
  it('createProvisioner builds by name', () => {
    expect(createProvisioner('opentofu', { moduleDir: '/x' }).id).toBe('opentofu');
  });
  it('unknown name throws with the available list', () => {
    expect(() => createProvisioner('nope', {})).toThrow(/unknown provisioner 'nope'.*opentofu/s);
  });
  it('is extensible', () => {
    registerProvisioner('fake', () => ({ id: 'fake', up: async () => ({ version: 1, runner: 'fake' }), down: async () => {} }));
    expect(createProvisioner('fake').id).toBe('fake');
  });
});

describe('iacModuleDir', () => {
  it('resolves to a shipped module that actually exists on disk', () => {
    const dir = iacModuleDir('fargate');
    expect(dir.endsWith(path.join('iac', 'fargate'))).toBe(true);
    // the whole point of the helper: the path is real (require.resolve on a
    // dir throws MODULE_NOT_FOUND, which is the bug it replaces)
    expect(existsSync(path.join(dir, 'versions.tf'))).toBe(true);
  });
});
