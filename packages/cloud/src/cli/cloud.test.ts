import { describe, it, expect } from 'vitest';
import { parseArgs, parseVars, buildRunTaskSpec, buildFixPrTaskSpec, collectRegistry, main, CloudCliDeps } from './cloud';
import { TargetDescriptor, LogLine, Status } from '../runner/types';

describe('parseArgs', () => {
  it('handles --k v, --k=v, bare flags, and repeats', () => {
    const { cmd, positionals, flags } = parseArgs([
      'run', 'pos1', '--image', 'img', '--repos=a,b', '--follow', '--var', 'x=1', '--var', 'y=2',
    ]);
    expect(cmd).toBe('run');
    expect(positionals).toEqual(['pos1']);
    expect(flags.image).toBe('img');
    expect(flags.repos).toBe('a,b');
    expect(flags.follow).toBe(true);
    expect(flags.var).toEqual(['x=1', 'y=2']);
  });
});

describe('parseVars', () => {
  it('splits key=value, keeps = in the value', () => {
    expect(parseVars(['region=us-east-1', 'k=a=b'])).toEqual({ region: 'us-east-1', k: 'a=b' });
  });
  it('rejects a var without =', () => {
    expect(() => parseVars(['bad'])).toThrow(/key=value/);
  });
});

describe('buildRunTaskSpec', () => {
  const flags = { image: 'img', repos: 'acme/api,acme/web', task: 'do it', owner: 'acme' };

  it('wires the runner-image env contract + tag-safe labels', () => {
    const spec = buildRunTaskSpec(flags, { GITHUB_TOKEN: 't' });
    expect(spec.image).toBe('img');
    expect(spec.command).toEqual(['nemus-cloud-agent']);
    expect(spec.env).toMatchObject({
      NEMUS_REPOS: 'acme/api,acme/web',
      NEMUS_TASK: 'do it',
      NEMUS_AGENT: 'pi',
      REPORT_MODE: 'pr',
      NEMUS_OWNER: 'acme',
      GITHUB_TOKEN: 't',
    });
    // the comma-bearing repo list must NOT leak into labels (ECS tag guard)
    expect(spec.labels).toEqual({ 'nemus.agent': 'pi', 'nemus.owner': 'acme' });
    expect(Object.values(spec.labels!).some((v) => v.includes(','))).toBe(false);
  });

  it('passes GitHub App creds through when present', () => {
    const spec = buildRunTaskSpec(flags, {
      GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'k', GITHUB_APP_INSTALLATION_ID: '2',
    });
    expect(spec.env).toMatchObject({ GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2' });
    expect(spec.env!.GITHUB_TOKEN).toBeUndefined();
  });

  it('requires image/repos/task and forge auth', () => {
    expect(() => buildRunTaskSpec({ repos: 'a', task: 't' }, { GITHUB_TOKEN: 't' })).toThrow(/--image/);
    expect(() => buildRunTaskSpec({ image: 'i', task: 't' }, { GITHUB_TOKEN: 't' })).toThrow(/--repos/);
    expect(() => buildRunTaskSpec({ image: 'i', repos: 'a' }, { GITHUB_TOKEN: 't' })).toThrow(/--task/);
    expect(() => buildRunTaskSpec(flags, {})).toThrow(/no forge auth/);
  });
});

describe('buildFixPrTaskSpec', () => {
  const flags = { image: 'img', repo: 'acme/api', pr: '42', branch: 'nemus/fix', owner: 'acme' };

  it('wires the fix-pr env contract (NEMUS_MODE + PR coords) + tag-safe labels', () => {
    const spec = buildFixPrTaskSpec(flags, { GITHUB_TOKEN: 't' });
    expect(spec.command).toEqual(['nemus-cloud-agent']);
    expect(spec.env).toMatchObject({
      NEMUS_MODE: 'fix-pr',
      NEMUS_REPOS: 'acme/api',
      NEMUS_PR_NUMBER: '42',
      NEMUS_PR_BRANCH: 'nemus/fix',
      NEMUS_AGENT: 'pi',
      GITHUB_TOKEN: 't',
    });
    expect(spec.labels).toEqual({ 'nemus.agent': 'pi', 'nemus.mode': 'fix-pr', 'nemus.pr': '42', 'nemus.owner': 'acme' });
    expect(Object.values(spec.labels!).some((v) => v.includes(','))).toBe(false);
  });

  it('forwards the code-host selector + notifier sinks + CI tuning', () => {
    const spec = buildFixPrTaskSpec(
      { ...flags, 'max-iterations': '2', 'poll-interval-ms': '100', 'max-polls': '5' },
      { GITHUB_TOKEN: 't', NEMUS_FORGE_HOST: 'gitlab', GITLAB_API_URL: 'https://gl/api/v4', SLACK_WEBHOOK_URL: 'https://hook' },
    );
    expect(spec.env).toMatchObject({
      NEMUS_FORGE_HOST: 'gitlab',
      GITLAB_API_URL: 'https://gl/api/v4',
      SLACK_WEBHOOK_URL: 'https://hook',
      NEMUS_CI_MAX_ITERATIONS: '2',
      NEMUS_CI_POLL_INTERVAL_MS: '100',
      NEMUS_CI_MAX_POLLS: '5',
    });
  });

  it('validates its inputs', () => {
    expect(() => buildFixPrTaskSpec({ repo: 'a/b', pr: '1', branch: 'x' }, { GITHUB_TOKEN: 't' })).toThrow(/--image/);
    expect(() => buildFixPrTaskSpec({ image: 'i', pr: '1', branch: 'x' }, { GITHUB_TOKEN: 't' })).toThrow(/--repo/);
    expect(() => buildFixPrTaskSpec({ image: 'i', repo: 'a/b,c/d', pr: '1', branch: 'x' }, { GITHUB_TOKEN: 't' })).toThrow(/exactly one --repo/);
    expect(() => buildFixPrTaskSpec({ image: 'i', repo: 'a/b', branch: 'x' }, { GITHUB_TOKEN: 't' })).toThrow(/--pr/);
    expect(() => buildFixPrTaskSpec({ image: 'i', repo: 'a/b', pr: 'x', branch: 'b' }, { GITHUB_TOKEN: 't' })).toThrow(/--pr must be a number/);
    expect(() => buildFixPrTaskSpec({ image: 'i', repo: 'a/b', pr: '1' }, { GITHUB_TOKEN: 't' })).toThrow(/--branch/);
    expect(() => buildFixPrTaskSpec(flags, {})).toThrow(/no forge auth/);
  });
});

// --------- main() dispatch with fully injected deps (no real fs/cloud) ---------

function harness(overrides: Partial<CloudCliDeps> = {}) {
  const files = new Map<string, string>();
  const out: string[] = [];
  const calls: string[] = [];
  const target: TargetDescriptor = { version: 1, runner: 'fake', cluster: 'c', region: 'r' };
  const deps: CloudCliDeps = {
    createProvisioner: ((name: string, opts: any) => {
      calls.push(`provisioner:${name}:${opts.moduleDir}`);
      return {
        id: name,
        up: async () => { calls.push('up'); return target; },
        down: async () => { calls.push('down'); },
      };
    }) as any,
    createRunner: ((name: string) => {
      calls.push(`runner:${name}`);
      return {
        id: name,
        capabilities: {} as any,
        launch: async () => { calls.push('launch'); return { runner: name, id: 'task-1' }; },
        status: async (): Promise<Status> => ({ state: 'succeeded', exitCode: 0 }),
        logs: async function* (): AsyncIterable<LogLine> { yield { stream: 'stdout', line: 'hello' }; },
        stop: async () => {},
      };
    }) as any,
    iacModuleDir: (n) => `/iac/${n}`,
    runnerNames: () => ['docker', 'aws-fargate', 'kubernetes'],
    provisionerNames: () => ['opentofu', 'terraform'],
    registeredForges: () => ['github', 'gitlab'],
    listIacModules: () => ['fargate', 'kubernetes'],
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
    writeFile: (p, c) => { files.set(p, c); },
    log: (s) => out.push(s),
    errlog: (s) => out.push('ERR:' + s),
    env: { GITHUB_TOKEN: 't' },
    sleep: async () => {},
    ...overrides,
  };
  return { deps, files, out, calls, target };
}

describe('runners command', () => {
  // A capability-bearing createRunner so the snapshot reflects real flags.
  const capsOverride = {
    createRunner: ((name: string) => ({
      id: name,
      capabilities: {
        exec: name !== 'aws-fargate',
        logStream: true,
        persistentDisk: name === 'docker',
        secretStore: false,
        portForward: name !== 'aws-fargate',
      },
    })) as any,
  };

  it('collectRegistry reads every registry + per-runner caps + module\u2192runner', () => {
    const { deps, files } = harness(capsOverride);
    files.set('/iac/fargate/outputs.tf', 'runner = "aws-fargate"');
    files.set('/iac/kubernetes/outputs.tf', 'runner = "kubernetes"');
    const snap = collectRegistry(deps);
    expect(snap.runners.map((r) => r.name)).toEqual(['aws-fargate', 'docker', 'kubernetes']); // sorted
    expect(snap.runners.find((r) => r.name === 'docker')!.capabilities!.persistentDisk).toBe(true);
    expect(snap.provisioners).toEqual(['opentofu', 'terraform']);
    expect(snap.forges).toEqual(['github', 'gitlab']);
    expect(snap.modules).toEqual([
      { name: 'fargate', runner: 'aws-fargate' },
      { name: 'kubernetes', runner: 'kubernetes' },
    ]);
  });

  it('a runner that fails to construct is reported, not fatal', () => {
    const { deps } = harness({
      createRunner: ((name: string) => {
        if (name === 'kubernetes') throw new Error('no kubectl');
        return { id: name, capabilities: { exec: true, logStream: true, persistentDisk: false, secretStore: false, portForward: false } } as any;
      }) as any,
    });
    const snap = collectRegistry(deps);
    const k = snap.runners.find((r) => r.name === 'kubernetes')!;
    expect(k.capabilities).toBeNull();
    expect(k.error).toMatch(/no kubectl/);
  });

  it('main runners --json prints the snapshot and exits 0', async () => {
    const { deps, out } = harness(capsOverride);
    const code = await main(['runners', '--json'], deps);
    expect(code).toBe(0);
    const printed = JSON.parse(out.join('\n'));
    expect(printed.runners.map((r: any) => r.name)).toContain('kubernetes');
    expect(printed.forges).toEqual(['github', 'gitlab']);
  });

  it('main runners prints a human table', async () => {
    const { deps, out } = harness(capsOverride);
    const code = await main(['runners'], deps);
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/Runners \(where a task executes\)/);
    expect(text).toMatch(/kubernetes/);
    expect(text).toMatch(/Git forges/);
  });
});

describe('main dispatch', () => {
  it('up: provisions and writes the descriptor file', async () => {
    const { deps, files, calls } = harness();
    const code = await main(['up', '--module', 'fargate', '--var', 'region=r'], deps);
    expect(code).toBe(0);
    expect(calls).toContain('provisioner:opentofu:/iac/fargate');
    expect(calls).toContain('up');
    expect(JSON.parse(files.get('.nemus-target.json')!).runner).toBe('fake');
  });

  it('run: loads target, launches, follows logs, waits for exit', async () => {
    const { deps, files, out, calls } = harness();
    files.set('.nemus-target.json', JSON.stringify({ version: 1, runner: 'fake' }));
    const code = await main(
      ['run', '--image', 'img', '--repos', 'a,b', '--task', 'x', '--follow', '--wait'],
      deps,
    );
    expect(code).toBe(0);
    expect(calls).toEqual(expect.arrayContaining(['runner:fake', 'launch']));
    expect(out).toContain('hello'); // streamed log
    expect(out.some((l) => l.includes('succeeded'))).toBe(true);
  });

  it('run: returns 1 when the task fails', async () => {
    const { deps, files } = harness({
      createRunner: ((name: string) => ({
        id: name, capabilities: {} as any,
        launch: async () => ({ runner: name, id: 't' }),
        status: async (): Promise<Status> => ({ state: 'failed', exitCode: 2 }),
        logs: async function* (): AsyncIterable<LogLine> {},
        stop: async () => {},
      })) as any,
    });
    files.set('.nemus-target.json', JSON.stringify({ version: 1, runner: 'fake' }));
    const code = await main(['run', '--image', 'i', '--repos', 'a', '--task', 't', '--wait'], deps);
    expect(code).toBe(1);
  });

  it('fix-pr: loads target and launches the fix-pr task', async () => {
    const { deps, files, calls, out } = harness();
    files.set('.nemus-target.json', JSON.stringify({ version: 1, runner: 'fake' }));
    const code = await main(
      ['fix-pr', '--image', 'img', '--repo', 'acme/api', '--pr', '42', '--branch', 'nemus/fix', '--wait'],
      deps,
    );
    expect(code).toBe(0);
    expect(calls).toEqual(expect.arrayContaining(['runner:fake', 'launch']));
    expect(out.some((l) => l.includes('succeeded'))).toBe(true);
  });

  it('down: reads target then destroys', async () => {
    const { deps, files, calls } = harness();
    files.set('.nemus-target.json', JSON.stringify({ version: 1, runner: 'fake' }));
    const code = await main(['down', '--module', 'fargate'], deps);
    expect(code).toBe(0);
    expect(calls).toContain('down');
  });

  it('unknown command + missing forge auth surface errors', async () => {
    const bad = harness();
    expect(await main(['wat'], bad.deps)).toBe(1);
    expect(bad.out.some((l) => l.startsWith('ERR:'))).toBe(true);

    const noauth = harness({ env: {} });
    noauth.files.set('.nemus-target.json', JSON.stringify({ version: 1, runner: 'fake' }));
    expect(await main(['run', '--image', 'i', '--repos', 'a', '--task', 't'], noauth.deps)).toBe(1);
    expect(noauth.out.some((l) => l.includes('no forge auth'))).toBe(true);
  });
});
