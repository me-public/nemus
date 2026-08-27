import { spawn } from 'node:child_process';
import { CommandRunner, LogStreamer } from './docker';
import { shellExec } from '../agent/exec';
import {
  Capabilities,
  Handle,
  LogLine,
  Runner,
  Status,
  TargetDescriptor,
  TaskSpec,
} from './types';

export interface FargateRunnerOptions {
  /** aws binary (default 'aws'). */
  bin?: string;
  run?: CommandRunner;
  stream?: LogStreamer;
  /** Fargate needs a public IP (or a NAT) to pull the image + reach the forge. */
  assignPublicIp?: 'ENABLED' | 'DISABLED';
  /** Task family + container + log-stream-prefix name (default 'nemus-agent'). */
  family?: string;
}

const FARGATE_CAPS: Capabilities = {
  // ECS Exec needs enableExecuteCommand + an SSM-enabled task; not wired here, so
  // we report it honestly rather than pretend. (Features degrade, never lie.)
  exec: false,
  logStream: true, // CloudWatch Logs
  persistentDisk: false, // Fargate tasks are ephemeral (EFS is a future opt-in)
  secretStore: false, // resolve TaskSpec.secrets into env before launch (like docker)
  portForward: false,
};

/** What the runner stashes on the Handle so status/logs/stop (which only get a
 *  Handle) can reach the cluster/region/log-group. Core never reads this. */
interface FargateHandleRaw {
  cluster: string;
  region?: string;
  logGroup?: string;
  logStream?: string;
  taskDefArn: string;
}

/**
 * Runs one task as an AWS ECS Fargate task. Dependency-free: shells the `aws`
 * CLI (like DockerRunner shells docker). Reads its target from the descriptor
 * the `iac/fargate` module emits (`cluster`, `region`, `extra.subnets`,
 * `extra.security_group_id`, `extra.execution_role_arn`, `extra.log_group`).
 *
 * launch = register-task-definition → run-task; the durable cluster/roles/logs
 * were provisioned once by the Provisioner. `run`/`stream` are injectable so the
 * (many) aws CLI invocations + JSON parsing are unit-tested without AWS.
 */
export class FargateRunner implements Runner {
  readonly id = 'aws-fargate';
  readonly capabilities = FARGATE_CAPS;
  private readonly bin: string;
  private readonly run: CommandRunner;
  private readonly stream: LogStreamer;
  private readonly assignPublicIp: 'ENABLED' | 'DISABLED';
  private readonly family: string;

  constructor(opts: FargateRunnerOptions = {}) {
    this.bin = opts.bin ?? 'aws';
    this.run = opts.run ?? ((b, a) => shellExec(b, a));
    this.stream = opts.stream ?? defaultCloudWatchStream;
    this.assignPublicIp = opts.assignPublicIp ?? 'ENABLED';
    this.family = opts.family ?? 'nemus-agent';
  }

  async launch(spec: TaskSpec, target: TargetDescriptor): Promise<Handle> {
    if (target.runner !== this.id) {
      throw new Error(`fargate runner: target is for "${target.runner}", not "${this.id}"`);
    }
    if (spec.secrets?.length) {
      throw new Error(
        'fargate runner has no secret store — resolve TaskSpec.secrets into env before launch',
      );
    }
    const cluster = target.cluster;
    if (!cluster) throw new Error('fargate target missing "cluster"');
    const region = target.region;
    const extra = (target.extra ?? {}) as Record<string, unknown>;
    const subnets = asStringArray(extra.subnets);
    if (!subnets.length) throw new Error('fargate target missing "extra.subnets"');
    const securityGroups = extra.security_group_id ? [String(extra.security_group_id)] : [];
    const executionRoleArn = extra.execution_role_arn ? String(extra.execution_role_arn) : undefined;
    const logGroup = extra.log_group ? String(extra.log_group) : undefined;

    // 1) Register the per-run task definition.
    const taskDef = this.buildTaskDefinition(spec, { executionRoleArn, logGroup, region });
    const reg = await this.aws(
      ['ecs', 'register-task-definition', '--cli-input-json', JSON.stringify(taskDef)],
      region,
    );
    const taskDefArn: string = reg.taskDefinition?.taskDefinitionArn;
    if (!taskDefArn) throw new Error('register-task-definition returned no ARN');

    // 2) Run it.
    const runArgs = [
      'ecs', 'run-task',
      '--cluster', cluster,
      '--task-definition', taskDefArn,
      '--launch-type', 'FARGATE',
      '--count', '1',
      '--network-configuration',
      JSON.stringify({
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: this.assignPublicIp,
        },
      }),
    ];
    const tags = tagArgs(spec.labels);
    if (tags.length) runArgs.push('--tags', ...tags);

    const runOut = await this.aws(runArgs, region);
    const failure = runOut.failures?.[0];
    if (failure) throw new Error(`run-task failed: ${failure.reason ?? JSON.stringify(failure)}`);
    const taskArn: string = runOut.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error('run-task returned no taskArn');

    const raw: FargateHandleRaw = {
      cluster,
      region,
      logGroup,
      logStream: logGroup ? `${this.family}/${this.family}/${taskId(taskArn)}` : undefined,
      taskDefArn,
    };
    return { runner: this.id, id: taskArn, raw };
  }

  async status(handle: Handle): Promise<Status> {
    const raw = handle.raw as FargateHandleRaw;
    const out = await this.aws(
      ['ecs', 'describe-tasks', '--cluster', raw.cluster, '--tasks', handle.id],
      raw.region,
    );
    const task = out.tasks?.[0];
    if (!task) return { state: 'unknown' };
    const container = task.containers?.[0];
    const exitCode = typeof container?.exitCode === 'number' ? container.exitCode : undefined;
    return {
      state: mapFargateState(task.lastStatus, exitCode),
      exitCode,
      startedAt: parseDate(task.startedAt),
      finishedAt: parseDate(task.stoppedAt),
    };
  }

  logs(handle: Handle): AsyncIterable<LogLine> {
    const raw = handle.raw as FargateHandleRaw;
    if (!raw.logGroup || !raw.logStream) return emptyAsync();
    const args = ['logs', 'tail', raw.logGroup, '--follow', '--format', 'short', '--log-stream-names', raw.logStream];
    if (raw.region) args.push('--region', raw.region);
    return this.stream(this.bin, args);
  }

  async stop(handle: Handle): Promise<void> {
    const raw = handle.raw as FargateHandleRaw;
    await this.run(this.bin, awsArgs(['ecs', 'stop-task', '--cluster', raw.cluster, '--task', handle.id], raw.region));
  }

  /** Build the register-task-definition input (pure → unit-tested). */
  private buildTaskDefinition(
    spec: TaskSpec,
    opts: { executionRoleArn?: string; logGroup?: string; region?: string },
  ): Record<string, unknown> {
    const environment = Object.entries(spec.env ?? {}).map(([name, value]) => ({ name, value }));
    const container: Record<string, unknown> = {
      name: this.family,
      image: spec.image,
      essential: true,
      environment,
    };
    if (spec.command?.length) container.command = spec.command;
    if (opts.logGroup) {
      container.logConfiguration = {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': opts.logGroup,
          'awslogs-region': opts.region ?? '',
          'awslogs-stream-prefix': this.family,
        },
      };
    }
    const def: Record<string, unknown> = {
      family: this.family,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: String(cpuUnits(spec.resources?.cpu)),
      memory: String(spec.resources?.memoryMB ?? 2048),
      containerDefinitions: [container],
    };
    if (opts.executionRoleArn) def.executionRoleArn = opts.executionRoleArn;
    return def;
  }

  /** Run an aws subcommand with `--output json` and parse stdout. */
  private async aws(args: string[], region?: string): Promise<any> {
    const full = awsArgs(args, region);
    const { code, stdout, stderr } = await this.run(this.bin, full);
    if (code !== 0) throw new Error(`aws ${args.slice(0, 2).join(' ')} failed (${code}): ${stderr.trim() || stdout.trim()}`);
    if (!stdout.trim()) return {};
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`aws ${args.slice(0, 2).join(' ')}: could not parse JSON output`);
    }
  }
}

/** Append `--region` + force JSON output. Exported-shape helper (pure). */
function awsArgs(args: string[], region?: string): string[] {
  const out = [...args, '--output', 'json'];
  if (region) out.push('--region', region);
  return out;
}

function tagArgs(labels?: Record<string, string>): string[] {
  return Object.entries(labels ?? {}).map(([k, v]) => `key=${k},value=${v}`);
}

/** Fargate cpu is in CPU units (1 vCPU = 1024). We accept vCPU as a fraction. */
function cpuUnits(cpu?: number): number {
  if (!cpu || cpu <= 0) return 1024;
  return cpu < 16 ? Math.round(cpu * 1024) : Math.round(cpu); // treat >=16 as already-units
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function taskId(taskArn: string): string {
  return taskArn.split('/').pop() ?? taskArn;
}

export function mapFargateState(lastStatus: string | undefined, exitCode?: number): Status['state'] {
  switch (lastStatus) {
    case 'PROVISIONING':
    case 'PENDING':
    case 'ACTIVATING':
      return 'pending';
    case 'RUNNING':
    case 'DEACTIVATING':
    case 'STOPPING':
    case 'DEPROVISIONING':
      return 'running';
    case 'STOPPED':
      return exitCode === 0 ? 'succeeded' : 'failed';
    default:
      return 'unknown';
  }
}

function parseDate(s?: string | number): Date | undefined {
  if (s === undefined || s === null) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t) : undefined;
}

async function* emptyAsync(): AsyncIterable<LogLine> {
  // no log group configured → nothing to stream
}

/** `aws logs tail --follow` streamer (CloudWatch merges streams → all stdout). */
const defaultCloudWatchStream: LogStreamer = async function* (bin, args) {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const queue: LogLine[] = [];
  let done = false;
  let failure: Error | undefined;
  let notify: (() => void) | null = null;
  child.stdout.on('data', (buf: Buffer) => {
    for (const raw of buf.toString().split('\n')) {
      if (raw === '') continue;
      queue.push({ stream: 'stdout', line: raw });
    }
    notify?.();
  });
  child.stderr.on('data', (buf: Buffer) => {
    for (const raw of buf.toString().split('\n')) {
      if (raw === '') continue;
      queue.push({ stream: 'stderr', line: raw });
    }
    notify?.();
  });
  child.on('error', (e) => {
    failure = e instanceof Error ? e : new Error(String(e));
    done = true;
    notify?.();
  });
  child.on('close', () => {
    done = true;
    notify?.();
  });
  while (!done || queue.length) {
    if (queue.length) yield queue.shift()!;
    else {
      await new Promise<void>((r) => (notify = r));
      notify = null;
    }
  }
  if (failure) throw new Error(`aws logs tail stream failed: ${failure.message}`);
};
