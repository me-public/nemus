import { spawn } from 'node:child_process';
import {
  Capabilities,
  ExecResult,
  Handle,
  LogLine,
  Runner,
  Status,
  TargetDescriptor,
  TaskSpec,
} from './types';

/** One-shot command runner (injectable for tests). */
export type CommandRunner = (
  bin: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Streaming command runner for `docker logs -f` (injectable for tests). */
export type LogStreamer = (bin: string, args: string[]) => AsyncIterable<LogLine>;

export interface DockerRunnerOptions {
  /** docker binary (default 'docker'); e.g. 'podman' is CLI-compatible. */
  bin?: string;
  run?: CommandRunner;
  stream?: LogStreamer;
}

const DOCKER_CAPS: Capabilities = {
  exec: true,
  logStream: true,
  persistentDisk: true, // via volumes
  secretStore: false, // secrets must be pre-resolved into env
  portForward: true,
};

/**
 * The in-box runner: a task is a local Docker (or Podman) container. Needs no
 * cloud account — this is what keeps the whole design honest (the litmus test).
 * Dependency-free: shells the docker CLI via child_process.
 */
export class DockerRunner implements Runner {
  readonly id = 'docker';
  readonly capabilities = DOCKER_CAPS;
  private readonly bin: string;
  private readonly run: CommandRunner;
  private readonly stream: LogStreamer;

  constructor(opts: DockerRunnerOptions = {}) {
    this.bin = opts.bin ?? 'docker';
    this.run = opts.run ?? defaultRun;
    this.stream = opts.stream ?? defaultStream;
  }

  async launch(spec: TaskSpec, target: TargetDescriptor): Promise<Handle> {
    if (target.runner !== this.id) {
      throw new Error(`docker runner: target is for "${target.runner}", not "docker"`);
    }
    if (spec.secrets?.length) {
      // Capability honesty: no secret store here. The orchestrator must resolve
      // secrets into env first, rather than us silently dropping them.
      throw new Error(
        'docker runner has no secret store — resolve TaskSpec.secrets into env before launch',
      );
    }

    const args = ['run', '-d'];
    if (spec.resources?.cpu) args.push('--cpus', String(spec.resources.cpu));
    if (spec.resources?.memoryMB) args.push('--memory', `${spec.resources.memoryMB}m`);
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push('-e', `${k}=${v}`);
    for (const [k, v] of Object.entries(spec.labels ?? {})) args.push('--label', `${k}=${v}`);
    args.push(spec.image);
    if (spec.command?.length) args.push(...spec.command);

    const { code, stdout, stderr } = await this.run(this.bin, args);
    if (code !== 0) throw new Error(`docker run failed (${code}): ${stderr.trim() || stdout.trim()}`);
    const id = stdout.trim().split('\n').pop()!.trim();
    if (!id) throw new Error('docker run: no container id returned');
    return { runner: this.id, id };
  }

  async status(handle: Handle): Promise<Status> {
    const { code, stdout } = await this.run(this.bin, [
      'inspect',
      '--format',
      '{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}',
      handle.id,
    ]);
    if (code !== 0) return { state: 'unknown' };
    const [dockerState, exitStr, startedAt, finishedAt] = stdout.trim().split('|');
    const exitCode = Number(exitStr);
    return {
      state: mapDockerState(dockerState, exitCode),
      exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
      startedAt: parseDate(startedAt),
      finishedAt: parseDate(finishedAt),
    };
  }

  logs(handle: Handle): AsyncIterable<LogLine> {
    return this.stream(this.bin, ['logs', '-f', '--timestamps', handle.id]);
  }

  async exec(handle: Handle, argv: string[]): Promise<ExecResult> {
    const { code, stdout, stderr } = await this.run(this.bin, ['exec', handle.id, ...argv]);
    return { exitCode: code, stdout, stderr };
  }

  async stop(handle: Handle): Promise<void> {
    // Best-effort: stop then remove so a task never leaks a container.
    await this.run(this.bin, ['stop', handle.id]);
    await this.run(this.bin, ['rm', '-f', handle.id]).catch(() => undefined);
  }
}

function mapDockerState(s: string, exitCode: number): Status['state'] {
  switch (s) {
    case 'created':
    case 'restarting':
      return 'pending';
    case 'running':
    case 'paused':
      return 'running';
    case 'exited':
      return exitCode === 0 ? 'succeeded' : 'failed';
    case 'dead':
      return 'failed';
    case 'removing':
      return 'stopped';
    default:
      return 'unknown';
  }
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  // Docker reports a zero-value timestamp when unset.
  return Number.isFinite(t) && !s.startsWith('0001-01-01') ? new Date(t) : undefined;
}

const defaultRun: CommandRunner = (bin, args) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: String(e) }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const defaultStream: LogStreamer = async function* (bin, args) {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const queue: LogLine[] = [];
  let done = false;
  let failure: Error | undefined;
  let notify: (() => void) | null = null;
  const push = (stream: LogLine['stream']) => (buf: Buffer) => {
    for (const raw of buf.toString().split('\n')) {
      if (raw === '') continue;
      queue.push({ stream, line: raw });
    }
    notify?.();
  };
  child.stdout.on('data', push('stdout'));
  child.stderr.on('data', push('stderr'));
  // ENOENT (e.g. docker not installed) emits 'error' with NO 'close' — without
  // this the consumer's `for await` would hang forever.
  child.on('error', (e) => {
    failure = e instanceof Error ? e : new Error(String(e));
    done = true;
    notify?.();
  });
  child.on('close', () => {
    done = true;
    notify?.();
  });
  try {
    while (!done || queue.length) {
      if (queue.length) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => (notify = r));
        notify = null;
      }
    }
    if (failure) throw new Error(`docker logs stream failed: ${failure.message}`);
  } finally {
    // If the consumer breaks early (e.g. a bounded tail), kill the still-running
    // `logs -f` child so its open stdout pipe can't keep the event loop alive.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
};
