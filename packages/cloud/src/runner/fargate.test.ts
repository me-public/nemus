import { describe, it, expect } from 'vitest';
import { FargateRunner, mapFargateState } from './fargate';
import { createRunner, runnerNames } from './registry';
import { CommandRunner } from './docker';
import { TargetDescriptor, TaskSpec, LogLine } from './types';

const target: TargetDescriptor = {
  version: 1,
  runner: 'aws-fargate',
  region: 'us-east-1',
  cluster: 'nemus',
  extra: {
    subnets: ['subnet-a', 'subnet-b'],
    security_group_id: 'sg-123',
    execution_role_arn: 'arn:aws:iam::1:role/exec',
    log_group: '/nemus/nemus',
  },
};

const spec: TaskSpec = {
  image: 'ghcr.io/acme/agent:latest',
  env: { NEMUS_TASK: 'do it', GIT_TOKEN: 't' },
  command: ['nemus-cloud-agent'],
  resources: { cpu: 1, memoryMB: 2048 },
  labels: { 'nemus.owner': 'octocat' },
};

/** A CommandRunner that returns queued JSON by subcommand and records calls. */
function awsMock(responses: Record<string, unknown>) {
  const calls: { args: string[]; json?: any }[] = [];
  const run: CommandRunner = async (_bin, args) => {
    const key = `${args[0]} ${args[1]}`; // e.g. 'ecs register-task-definition'
    const jsonArg = args.includes('--cli-input-json') ? args[args.indexOf('--cli-input-json') + 1] : undefined;
    const ncArg = args.includes('--network-configuration') ? args[args.indexOf('--network-configuration') + 1] : undefined;
    calls.push({ args, json: jsonArg ? JSON.parse(jsonArg) : ncArg ? JSON.parse(ncArg) : undefined });
    return { code: 0, stdout: JSON.stringify(responses[key] ?? {}), stderr: '' };
  };
  return { run, calls };
}

describe('FargateRunner.launch', () => {
  it('registers a task definition then runs it, wiring target + spec', async () => {
    const { run, calls } = awsMock({
      'ecs register-task-definition': { taskDefinition: { taskDefinitionArn: 'arn:task/1' } },
      'ecs run-task': { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:1:task/nemus/abc123' }] },
    });
    const runner = new FargateRunner({ run });
    const handle = await runner.launch(spec, target);

    // register-task-definition JSON
    const reg = calls[0];
    expect(reg.args.slice(0, 2)).toEqual(['ecs', 'register-task-definition']);
    expect(reg.json.family).toBe('nemus-agent');
    expect(reg.json.requiresCompatibilities).toEqual(['FARGATE']);
    expect(reg.json.networkMode).toBe('awsvpc');
    expect(reg.json.cpu).toBe('1024'); // 1 vCPU -> 1024 units
    expect(reg.json.memory).toBe('2048');
    expect(reg.json.executionRoleArn).toBe('arn:aws:iam::1:role/exec');
    const cd = reg.json.containerDefinitions[0];
    expect(cd.image).toBe('ghcr.io/acme/agent:latest');
    expect(cd.command).toEqual(['nemus-cloud-agent']);
    expect(cd.environment).toContainEqual({ name: 'NEMUS_TASK', value: 'do it' });
    expect(cd.logConfiguration.options['awslogs-group']).toBe('/nemus/nemus');
    expect(cd.logConfiguration.options['awslogs-region']).toBe('us-east-1');

    // run-task network + tags + region
    const rt = calls[1];
    expect(rt.args).toContain('--launch-type');
    expect(rt.args).toContain('FARGATE');
    expect(rt.args).toContain('--cluster');
    expect(rt.json.awsvpcConfiguration.subnets).toEqual(['subnet-a', 'subnet-b']);
    expect(rt.json.awsvpcConfiguration.securityGroups).toEqual(['sg-123']);
    expect(rt.json.awsvpcConfiguration.assignPublicIp).toBe('ENABLED');
    expect(rt.args).toContain('key=nemus.owner,value=octocat');
    expect(rt.args).toEqual(expect.arrayContaining(['--region', 'us-east-1', '--output', 'json']));

    // handle carries what status/logs/stop need
    expect(handle.id).toBe('arn:aws:ecs:us-east-1:1:task/nemus/abc123');
    expect((handle.raw as any).cluster).toBe('nemus');
    expect((handle.raw as any).logStream).toBe('nemus-agent/nemus-agent/abc123');
  });

  it('rejects a mismatched target and unresolved secrets', async () => {
    const { run } = awsMock({});
    const runner = new FargateRunner({ run });
    await expect(runner.launch(spec, { version: 1, runner: 'docker' })).rejects.toThrow(/not "aws-fargate"/);
    await expect(
      runner.launch({ ...spec, secrets: [{ name: 'X', from: 'env:X' }] }, target),
    ).rejects.toThrow(/no secret store/);
  });

  it('surfaces run-task failures', async () => {
    const { run } = awsMock({
      'ecs register-task-definition': { taskDefinition: { taskDefinitionArn: 'arn:task/1' } },
      'ecs run-task': { failures: [{ reason: 'RESOURCE:MEMORY' }], tasks: [] },
    });
    await expect(new FargateRunner({ run }).launch(spec, target)).rejects.toThrow(/RESOURCE:MEMORY/);
  });

  it('errors when the target lacks subnets', async () => {
    const { run } = awsMock({});
    await expect(
      new FargateRunner({ run }).launch(spec, { ...target, extra: { ...target.extra, subnets: [] } }),
    ).rejects.toThrow(/subnets/);
  });
});

describe('FargateRunner.status / stop / logs', () => {
  const handle = { runner: 'aws-fargate', id: 'arn:task/abc', raw: { cluster: 'nemus', region: 'us-east-1', logGroup: '/nemus/nemus', logStream: 's', taskDefArn: 'arn:td' } };

  it('maps describe-tasks to a Status', async () => {
    const { run, calls } = awsMock({
      'ecs describe-tasks': { tasks: [{ lastStatus: 'STOPPED', startedAt: '2026-01-01T00:00:00Z', stoppedAt: '2026-01-01T00:05:00Z', containers: [{ exitCode: 0 }] }] },
    });
    const st = await new FargateRunner({ run }).status(handle as any);
    expect(st.state).toBe('succeeded');
    expect(st.exitCode).toBe(0);
    expect(calls[0].args).toEqual(expect.arrayContaining(['--cluster', 'nemus', '--tasks', 'arn:task/abc']));
  });

  it('stop calls ecs stop-task', async () => {
    const { run, calls } = awsMock({ 'ecs stop-task': {} });
    await new FargateRunner({ run }).stop(handle as any);
    expect(calls[0].args.slice(0, 2)).toEqual(['ecs', 'stop-task']);
    expect(calls[0].args).toEqual(expect.arrayContaining(['--task', 'arn:task/abc']));
  });

  it('logs streams CloudWatch lines via the injected streamer', async () => {
    const stream = async function* (): AsyncIterable<LogLine> {
      yield { stream: 'stdout', line: 'hello' };
    };
    const runner = new FargateRunner({ run: awsMock({}).run, stream: () => stream() });
    const out: string[] = [];
    for await (const l of runner.logs(handle as any)) out.push(l.line);
    expect(out).toEqual(['hello']);
  });

  it('logs is empty when no log group is configured', async () => {
    const runner = new FargateRunner({ run: awsMock({}).run });
    const out: LogLine[] = [];
    for await (const l of runner.logs({ runner: 'aws-fargate', id: 'x', raw: { cluster: 'c' } } as any)) out.push(l);
    expect(out).toEqual([]);
  });
});

describe('mapFargateState + registry', () => {
  it('maps ECS lastStatus values', () => {
    expect(mapFargateState('PROVISIONING')).toBe('pending');
    expect(mapFargateState('RUNNING')).toBe('running');
    expect(mapFargateState('STOPPED', 0)).toBe('succeeded');
    expect(mapFargateState('STOPPED', 137)).toBe('failed');
    expect(mapFargateState('WAT')).toBe('unknown');
  });

  it('is registered in-box and reports exec:false honestly', () => {
    expect(runnerNames()).toContain('aws-fargate');
    const r = createRunner('aws-fargate');
    expect(r.id).toBe('aws-fargate');
    expect(r.capabilities.exec).toBe(false);
    expect(r.exec).toBeUndefined();
  });
});
