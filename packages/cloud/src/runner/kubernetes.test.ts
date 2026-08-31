import { describe, it, expect } from 'vitest';
import { KubernetesJobRunner, mapJobState, k8sResources } from './kubernetes';
import { createRunner, runnerNames } from './registry';
import { CommandRunner, LogStreamer } from './docker';
import { TargetDescriptor, TaskSpec, LogLine } from './types';

const target: TargetDescriptor = {
  version: 1,
  runner: 'kubernetes',
  extra: {
    namespace: 'agents',
    context: 'prod-cluster',
    service_account: 'nemus-agent',
    image_pull_secret: 'ghcr-pull',
  },
};

const spec: TaskSpec = {
  image: 'ghcr.io/acme/agent:latest',
  env: { NEMUS_TASK: 'do it', GIT_TOKEN: 't' },
  command: ['nemus-cloud-agent'],
  resources: { cpu: 0.5, memoryMB: 2048 },
  labels: { 'nemus.owner': 'octocat', 'nemus.agent': 'pi' },
};

/** A kubectl mock: returns queued JSON by "verb kind" and records calls +
 *  the manifest written to disk. */
function kubectlMock(responses: Record<string, unknown>) {
  const calls: string[][] = [];
  let manifest: any;
  const run: CommandRunner = async (_bin, args) => {
    calls.push(args);
    const key = `${args[0]} ${args[1]}`; // e.g. 'apply -f' -> 'apply -f'
    const resp = responses[`${args[0]} ${args[1]}`] ?? responses[args[0]];
    // jsonpath (raw) responses come back as plain strings.
    const body = typeof resp === 'string' ? resp : JSON.stringify(resp ?? {});
    return { code: 0, stdout: body, stderr: '' };
  };
  const writeManifest = async (content: string) => {
    manifest = JSON.parse(content);
    return { path: '/tmp/job.json', cleanup: async () => {} };
  };
  return { run, writeManifest, calls, getManifest: () => manifest };
}

describe('KubernetesJobRunner.launch', () => {
  it('renders a batch/v1 Job manifest and applies it, wiring target + spec', async () => {
    const { run, writeManifest, calls, getManifest } = kubectlMock({
      apply: { metadata: { name: 'nemus-agent-deadbeef' } },
    });
    const runner = new KubernetesJobRunner({ run, writeManifest });
    const handle = await runner.launch(spec, target);

    const m = getManifest();
    expect(m.apiVersion).toBe('batch/v1');
    expect(m.kind).toBe('Job');
    expect(m.metadata.namespace).toBe('agents');
    expect(m.spec.backoffLimit).toBe(0); // one-shot
    const pod = m.spec.template.spec;
    expect(pod.restartPolicy).toBe('Never');
    expect(pod.serviceAccountName).toBe('nemus-agent');
    expect(pod.imagePullSecrets).toEqual([{ name: 'ghcr-pull' }]);
    const c = pod.containers[0];
    expect(c.image).toBe('ghcr.io/acme/agent:latest');
    expect(c.command).toEqual(['nemus-cloud-agent']);
    expect(c.env).toContainEqual({ name: 'NEMUS_TASK', value: 'do it' });
    expect(c.resources.requests.cpu).toBe('500m'); // 0.5 vCPU -> milliCPU
    expect(c.resources.requests.memory).toBe('2048Mi');
    expect(c.resources.limits.memory).toBe('2048Mi');

    // kubectl apply argv carries namespace + context.
    const apply = calls[0];
    expect(apply.slice(0, 3)).toEqual(['apply', '-f', '/tmp/job.json']);
    expect(apply).toEqual(expect.arrayContaining(['-o', 'json', '--namespace', 'agents', '--context', 'prod-cluster']));

    // Handle carries the server-assigned name.
    expect(handle.runner).toBe('kubernetes');
    expect(handle.id).toBe('nemus-agent-deadbeef');
  });

  it('rejects a mismatched target and unresolved secrets', async () => {
    const { run, writeManifest } = kubectlMock({});
    const runner = new KubernetesJobRunner({ run, writeManifest });
    await expect(runner.launch(spec, { version: 1, runner: 'docker' })).rejects.toThrow(/target is for "docker"/);
    await expect(
      runner.launch({ ...spec, secrets: [{ name: 'X', from: 'dotenv:X' }] }, target),
    ).rejects.toThrow(/no secret store/);
  });
});

describe('KubernetesJobRunner.status', () => {
  const cases: Array<[Record<string, number>, string, number | undefined]> = [
    [{ succeeded: 1 }, 'succeeded', 0],
    [{ failed: 1 }, 'failed', 1],
    [{ active: 1 }, 'running', undefined],
    [{}, 'pending', undefined],
  ];
  for (const [status, state, exitCode] of cases) {
    it(`maps job status ${JSON.stringify(status)} -> ${state}`, async () => {
      const { run } = kubectlMock({ 'get job': { status } });
      const runner = new KubernetesJobRunner({ run, writeManifest: async () => ({ path: '/x', cleanup: async () => {} }) });
      const st = await runner.status({ runner: 'kubernetes', id: 'j', raw: { namespace: 'agents', jobName: 'j' } });
      expect(st.state).toBe(state);
      expect(st.exitCode).toBe(exitCode);
    });
  }
});

describe('KubernetesJobRunner.exec', () => {
  it('resolves the job pod then execs argv into it', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = async (_bin, args) => {
      calls.push(args);
      if (args[0] === 'get' && args[1] === 'pods') return { code: 0, stdout: 'nemus-agent-x-abcde', stderr: '' };
      return { code: 0, stdout: 'hi', stderr: '' };
    };
    const runner = new KubernetesJobRunner({ run, writeManifest: async () => ({ path: '/x', cleanup: async () => {} }) });
    const res = await runner.exec({ runner: 'kubernetes', id: 'j', raw: { namespace: 'agents', jobName: 'j' } }, ['echo', 'hi']);
    expect(res).toEqual({ exitCode: 0, stdout: 'hi', stderr: '' });
    const execCall = calls.find((a) => a[0] === 'exec')!;
    // Namespace flag MUST come before the `--` separator (else it's an arg to echo).
    expect(execCall).toEqual(['exec', 'nemus-agent-x-abcde', '--namespace', 'agents', '--', 'echo', 'hi']);
  });
});

describe('KubernetesJobRunner.logs / stop', () => {
  it('streams `logs -f job/<name>` and deletes the job on stop', async () => {
    const streamed: string[][] = [];
    const stream: LogStreamer = async function* (_bin, args) {
      streamed.push(args);
      yield { stream: 'stdout', line: 'hello' } as LogLine;
    };
    const calls: string[][] = [];
    const run: CommandRunner = async (_bin, args) => (calls.push(args), { code: 0, stdout: '', stderr: '' });
    const runner = new KubernetesJobRunner({ run, stream, writeManifest: async () => ({ path: '/x', cleanup: async () => {} }) });
    const handle = { runner: 'kubernetes', id: 'j', raw: { namespace: 'agents', jobName: 'j' } };

    const lines: LogLine[] = [];
    for await (const l of runner.logs(handle)) lines.push(l);
    expect(lines).toEqual([{ stream: 'stdout', line: 'hello' }]);
    expect(streamed[0]).toEqual(expect.arrayContaining(['logs', 'job/j', '--follow', '--namespace', 'agents']));

    await runner.stop(handle);
    expect(calls[0]).toEqual(expect.arrayContaining(['delete', 'job', 'j', '--wait=false', '--ignore-not-found']));
  });
});

describe('kubectl error handling', () => {
  it('surfaces a non-zero kubectl exit', async () => {
    const run: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'Error from server (NotFound)' });
    const runner = new KubernetesJobRunner({ run, writeManifest: async () => ({ path: '/x', cleanup: async () => {} }) });
    await expect(runner.status({ runner: 'kubernetes', id: 'j', raw: { namespace: 'agents', jobName: 'j' } })).rejects.toThrow(
      /kubectl get job failed \(1\): Error from server/,
    );
  });
});

describe('k8sResources', () => {
  it('maps vCPU + memory, and returns undefined when nothing is set', () => {
    expect(k8sResources({ cpu: 2, memoryMB: 4096 })).toEqual({ requests: { cpu: '2', memory: '4096Mi' }, limits: { cpu: '2', memory: '4096Mi' } });
    expect(k8sResources({ cpu: 0.25 })).toEqual({ requests: { cpu: '250m' }, limits: { cpu: '250m' } });
    expect(k8sResources(undefined)).toBeUndefined();
    expect(k8sResources({})).toBeUndefined();
  });
});

describe('mapJobState', () => {
  it('prioritizes terminal states over active', () => {
    expect(mapJobState({ succeeded: 1, active: 1 })).toBe('succeeded');
    expect(mapJobState({ failed: 1 })).toBe('failed');
    expect(mapJobState({ active: 2 })).toBe('running');
    expect(mapJobState({})).toBe('pending');
  });
});

describe('registry', () => {
  it('registers kubernetes and creates it', () => {
    expect(runnerNames()).toContain('kubernetes');
    expect(createRunner('kubernetes').id).toBe('kubernetes');
  });
});
