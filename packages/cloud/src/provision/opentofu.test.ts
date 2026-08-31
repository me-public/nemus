import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
  target: { value: { version: 1, runner: 'aws-fargate', region: 'us-east-1', cluster: 'nemus', extra: { log_group: '/nemus' } } },
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
    expect(target).toEqual({ version: 1, runner: 'aws-fargate', region: 'us-east-1', cluster: 'nemus', extra: { log_group: '/nemus' } });
  });

  it('down runs init THEN destroy with construction + handed-back vars', async () => {
    const { exec, calls } = recorder();
    const p = new OpenTofuProvisioner({ moduleDir: '/iac/fly', bin: 'terraform', vars: { org: 'acme' }, exec });
    await p.down({ version: 1, runner: 'fly', extra: { tofu_vars: { app: 'demo' } } });
    // init must run before destroy: a fresh process has no provider plugins
    expect(calls.map((c) => c.args[1])).toEqual(['init', 'destroy']);
    expect(calls.every((c) => c.bin === 'terraform')).toBe(true);
    const destroy = calls[1].args;
    expect(destroy).toContain('-auto-approve');
    expect(destroy).toContain('org=acme');
    expect(destroy).toContain('app=demo');
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
  it('createProvisioner builds by name, and terraform self-reports its own id', () => {
    expect(createProvisioner('opentofu', { moduleDir: '/x' }).id).toBe('opentofu');
    expect(createProvisioner('terraform', { moduleDir: '/x' }).id).toBe('terraform');
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

  it('ships the kubernetes module with all four .tf files', () => {
    const dir = iacModuleDir('kubernetes');
    expect(dir.endsWith(path.join('iac', 'kubernetes'))).toBe(true);
    for (const f of ['versions.tf', 'variables.tf', 'main.tf', 'outputs.tf']) {
      expect(existsSync(path.join(dir, f))).toBe(true);
    }
  });

  it('the kubernetes module emits a kubernetes-runner target descriptor', () => {
    // Guard the module<->runner contract without needing a cluster: the output
    // block must declare runner = "kubernetes" and the four extra handles the
    // KubernetesJobRunner reads.
    const outputs = readFileSync(path.join(iacModuleDir('kubernetes'), 'outputs.tf'), 'utf8');
    expect(outputs).toMatch(/runner\s*=\s*"kubernetes"/);
    for (const key of ['namespace', 'context', 'service_account', 'image_pull_secret', 'tofu_vars']) {
      expect(outputs).toContain(key);
    }
    // The descriptor must pin the RESOLVED context, not pass an empty
    // var.kube_context (ambient current-context) straight through.
    expect(outputs).toContain('local.effective_context');
    expect(outputs).not.toMatch(/context\s*=\s*var\.kube_context/);
  });
});

describe('iac/kubernetes current-context helper', () => {
  const script = path.join(iacModuleDir('kubernetes'), 'scripts', 'current-context.sh');

  // Run the helper with `kubectl` stubbed on PATH via a temp dir. `query` is fed
  // on stdin exactly as the `data "external"` protocol does.
  function runWith(kubectlBody: string, query = ''): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'nemus-kctx-'));
    try {
      const shim = path.join(dir, 'kubectl');
      writeFileSync(shim, `#!/bin/sh\n${kubectlBody}\n`, { mode: 0o755 });
      return execFileSync('sh', [script], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
        input: query,
        encoding: 'utf8',
      }).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('emits the active context as JSON', () => {
    expect(runWith('echo arn:aws:eks:us-east-1:1:cluster/prod')).toBe(
      '{"context":"arn:aws:eks:us-east-1:1:cluster/prod"}',
    );
  });

  it('falls back to an empty context (exit 0) when kubectl fails', () => {
    expect(runWith('echo "not set" >&2; exit 1')).toBe('{"context":""}');
  });

  it('JSON-escapes a quote in the context name', () => {
    expect(runWith('printf \'weird"ctx\\n\'')).toBe('{"context":"weird\\"ctx"}');
  });

  it('threads the query kubeconfig through to kubectl --kubeconfig', () => {
    // Stub echoes kubectl's argv so we can see the flag the script built.
    const out = runWith('echo "ctx:$*"', '{"kubeconfig":"/custom/cfg"}');
    expect(out).toBe('{"context":"ctx:--kubeconfig=/custom/cfg config current-context"}');
  });

  it('expands a leading ~ in the kubeconfig path', () => {
    const out = runWith('echo "ctx:$*"', '{"kubeconfig":"~/.kube/config"}');
    expect(out).toContain(`--kubeconfig=${process.env.HOME}/.kube/config`);
  });
});
