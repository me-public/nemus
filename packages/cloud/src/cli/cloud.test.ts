import { describe, it, expect } from 'vitest';
import { parseArgs, parseVars, buildRunTaskSpec, main, CloudCliDeps } from './cloud';
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
