import { describe, it, expect } from 'vitest';
import { DockerRunner, CommandRunner, LogStreamer } from './docker';
import { createRunner, registerRunner, runnerNames } from './registry';
import { LogLine, TargetDescriptor, TaskSpec } from './types';

const target: TargetDescriptor = { version: 1, runner: 'docker' };

/** A CommandRunner stub that records invocations and returns queued results. */
function stubRun(results: Record<string, { code?: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = [];
  const run: CommandRunner = async (_bin, args) => {
    calls.push(args);
    const key = args[0]; // run | inspect | exec | stop | rm
    const r = results[key] ?? { code: 0, stdout: '', stderr: '' };
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { run, calls };
}

describe('DockerRunner.launch', () => {
  it('builds a correct `docker run` and returns the container id', async () => {
    const { run, calls } = stubRun({ run: { stdout: 'abc123def456\n' } });
    const runner = new DockerRunner({ run });
    const spec: TaskSpec = {
      image: 'ghcr.io/acme/agent:latest',
      env: { GIT_TOKEN: 'x', NEMUS_TASK: 'do the thing' },
      labels: { 'nemus.workspace': 'payments' },
      resources: { cpu: 2, memoryMB: 2048 },
      command: ['run', '--headless'],
    };
    const handle = await runner.launch(spec, target);

    expect(handle).toEqual({ runner: 'docker', id: 'abc123def456' });
    const a = calls[0];
    expect(a.slice(0, 2)).toEqual(['run', '-d']);
    expect(a).toContain('--cpus');
    expect(a).toContain('2');
    expect(a).toContain('--memory');
    expect(a).toContain('2048m');
    expect(a).toEqual(expect.arrayContaining(['-e', 'GIT_TOKEN=x', '-e', 'NEMUS_TASK=do the thing']));
    expect(a).toEqual(expect.arrayContaining(['--label', 'nemus.workspace=payments']));
    // image precedes the command
    const imgIdx = a.indexOf('ghcr.io/acme/agent:latest');
    expect(imgIdx).toBeGreaterThan(-1);
    expect(a.slice(imgIdx + 1)).toEqual(['run', '--headless']);
  });

  it('rejects a target meant for another runner', async () => {
    const { run } = stubRun({});
    const runner = new DockerRunner({ run });
    await expect(
      runner.launch({ image: 'x' }, { version: 1, runner: 'fly' }),
    ).rejects.toThrow(/target is for "fly"/);
  });

  it('refuses unresolved secrets (no secret store)', async () => {
    const { run } = stubRun({});
    const runner = new DockerRunner({ run });
    await expect(
      runner.launch({ image: 'x', secrets: [{ name: 'GIT_TOKEN', from: 'vault:git' }] }, target),
    ).rejects.toThrow(/no secret store/);
  });

  it('throws with stderr when docker run fails', async () => {
    const { run } = stubRun({ run: { code: 125, stderr: 'no such image' } });
    const runner = new DockerRunner({ run });
    await expect(runner.launch({ image: 'nope' }, target)).rejects.toThrow(/125.*no such image/);
  });
});

describe('DockerRunner.status', () => {
  const cases: Array<[string, number, string]> = [
    ['running', 0, 'running'],
    ['exited', 0, 'succeeded'],
    ['exited', 3, 'failed'],
    ['dead', 0, 'failed'],
    ['created', 0, 'pending'],
  ];
  for (const [dockerState, exit, expected] of cases) {
    it(`maps docker "${dockerState}" (exit ${exit}) -> ${expected}`, async () => {
      const { run } = stubRun({
        inspect: { stdout: `${dockerState}|${exit}|2026-01-01T00:00:00Z|0001-01-01T00:00:00Z\n` },
      });
      const runner = new DockerRunner({ run });
      const s = await runner.status({ runner: 'docker', id: 'c1' });
      expect(s.state).toBe(expected);
      expect(s.startedAt?.getUTCFullYear()).toBe(2026);
      expect(s.finishedAt).toBeUndefined(); // zero-value timestamp ignored
    });
  }

  it('returns unknown when inspect fails', async () => {
    const { run } = stubRun({ inspect: { code: 1 } });
    const runner = new DockerRunner({ run });
    expect((await runner.status({ runner: 'docker', id: 'gone' })).state).toBe('unknown');
  });
});

describe('DockerRunner.exec + stop', () => {
  it('exec returns exit code + streams', async () => {
    const { run, calls } = stubRun({ exec: { code: 0, stdout: 'clean\n' } });
    const runner = new DockerRunner({ run });
    const r = await runner.exec!({ runner: 'docker', id: 'c1' }, ['git', 'status', '-s']);
    expect(r).toEqual({ exitCode: 0, stdout: 'clean\n', stderr: '' });
    expect(calls[0]).toEqual(['exec', 'c1', 'git', 'status', '-s']);
  });

  it('stop does stop then rm -f', async () => {
    const { run, calls } = stubRun({});
    const runner = new DockerRunner({ run });
    await runner.stop({ runner: 'docker', id: 'c1' });
    expect(calls[0]).toEqual(['stop', 'c1']);
    expect(calls[1]).toEqual(['rm', '-f', 'c1']);
  });
});

describe('DockerRunner.logs', () => {
  it('rejects (does not hang) when the docker binary is missing', async () => {
    // Uses the REAL default streamer against a nonexistent bin -> spawn 'error'.
    const runner = new DockerRunner({ bin: 'nemus-no-such-bin-xyz' });
    await expect(
      (async () => {
        for await (const _ of runner.logs({ runner: 'docker', id: 'c1' })) void _;
      })(),
    ).rejects.toThrow(/docker logs stream failed/);
  });

  it('yields the streamed log lines', async () => {
    const fake: LogStreamer = async function* () {
      yield { stream: 'stdout', line: 'cloning…' } as LogLine;
      yield { stream: 'stderr', line: 'warning: slow' } as LogLine;
      yield { stream: 'stdout', line: 'done' } as LogLine;
    };
    const runner = new DockerRunner({ stream: fake });
    const out: string[] = [];
    for await (const l of runner.logs({ runner: 'docker', id: 'c1' })) {
      out.push(`${l.stream}:${l.line}`);
    }
    expect(out).toEqual(['stdout:cloning…', 'stderr:warning: slow', 'stdout:done']);
  });
});

describe('runner registry', () => {
  it('ships docker in-box', () => {
    expect(runnerNames()).toContain('docker');
    expect(createRunner('docker').id).toBe('docker');
  });

  it('throws for an unknown runner, listing the known ones', () => {
    expect(() => createRunner('fly')).toThrow(/unknown runner "fly".*docker/s);
  });

  it('lets a plugin register a new backend', () => {
    registerRunner('fake', () => ({
      id: 'fake',
      capabilities: { exec: false, logStream: false, persistentDisk: false, secretStore: false, portForward: false },
      launch: async () => ({ runner: 'fake', id: '1' }),
      status: async () => ({ state: 'running' as const }),
      logs: async function* () {},
      stop: async () => undefined,
    }));
    expect(createRunner('fake').id).toBe('fake');
  });
});
