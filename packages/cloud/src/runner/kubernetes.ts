import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRunner, LogStreamer } from './docker';
import { shellExec } from '../agent/exec';
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

/** Writes a manifest to a temp file and returns its path (injectable for tests). */
export type ManifestWriter = (content: string) => Promise<{ path: string; cleanup: () => Promise<void> }>;

export interface KubernetesRunnerOptions {
  /** kubectl binary (default 'kubectl'). */
  bin?: string;
  run?: CommandRunner;
  stream?: LogStreamer;
  writeManifest?: ManifestWriter;
  /** Job name prefix + container name (default 'nemus-agent'). */
  namePrefix?: string;
}

/** How long `logs --follow` waits for the pod to reach Running before streaming.
 *  Covers a cold image pull; if the pod never runs, status() reports the failure. */
const LOG_POD_RUNNING_TIMEOUT = '5m';

const K8S_CAPS: Capabilities = {
  exec: true, // kubectl exec into the job's pod
  logStream: true, // kubectl logs -f
  persistentDisk: false, // no PVC wired yet (a future opt-in via target.extra)
  secretStore: false, // resolve TaskSpec.secrets into env before launch (like docker/fargate)
  portForward: true, // kubectl port-forward
};

/** Stashed on the Handle so status/logs/exec/stop can reach the cluster. Core
 *  never reads this. */
interface K8sHandleRaw {
  namespace: string;
  context?: string;
  jobName: string;
  /** How long `logs --follow` waits for the pod to be Running (kubectl
   *  `--pod-running-timeout`). Tunable via target.extra.logs_pod_running_timeout. */
  logsPodRunningTimeout?: string;
}

/**
 * Runs one task as a Kubernetes **Job** (`batch/v1`). Vendor-neutral compute:
 * the same descriptor works on EKS/GKE/AKS, k3s, kind, or an on-prem cluster —
 * the litmus test for the runner seam being real and not Fargate-shaped.
 *
 * Dependency-free: shells `kubectl` (like DockerRunner shells docker), reads its
 * target from the descriptor (`extra.namespace`, `extra.context`,
 * `extra.service_account`, `extra.image_pull_secret`). launch = render a Job
 * manifest → `kubectl apply -f - -o json`; the manifest write + every kubectl
 * call are injected, so the JSON parsing + argv are unit-tested without a
 * cluster.
 */
export class KubernetesJobRunner implements Runner {
  readonly id = 'kubernetes';
  readonly capabilities = K8S_CAPS;
  private readonly bin: string;
  private readonly run: CommandRunner;
  private readonly stream: LogStreamer;
  private readonly writeManifest: ManifestWriter;
  private readonly namePrefix: string;

  constructor(opts: KubernetesRunnerOptions = {}) {
    this.bin = opts.bin ?? 'kubectl';
    this.run = opts.run ?? ((b, a) => shellExec(b, a));
    this.stream = opts.stream ?? defaultKubectlStream;
    this.writeManifest = opts.writeManifest ?? defaultManifestWriter;
    this.namePrefix = opts.namePrefix ?? 'nemus-agent';
  }

  async launch(spec: TaskSpec, target: TargetDescriptor): Promise<Handle> {
    if (target.runner !== this.id) {
      throw new Error(`kubernetes runner: target is for "${target.runner}", not "${this.id}"`);
    }
    if (spec.secrets?.length) {
      throw new Error(
        'kubernetes runner has no secret store wired — resolve TaskSpec.secrets into env before launch',
      );
    }
    const extra = (target.extra ?? {}) as Record<string, unknown>;
    const namespace = String(extra.namespace ?? 'default');
    const context = extra.context ? String(extra.context) : undefined;
    const logsPodRunningTimeout = extra.logs_pod_running_timeout
      ? String(extra.logs_pod_running_timeout)
      : undefined;

    const jobName = `${this.namePrefix}-${randomBytes(4).toString('hex')}`;
    const manifest = this.buildJobManifest(spec, { jobName, namespace, extra });

    const { path, cleanup } = await this.writeManifest(JSON.stringify(manifest));
    try {
      const applied = await this.kubectl(
        ['apply', '-f', path, '-o', 'json'],
        { namespace, context },
      );
      const createdName: string = applied?.metadata?.name ?? jobName;
      const raw: K8sHandleRaw = { namespace, context, jobName: createdName, logsPodRunningTimeout };
      return { runner: this.id, id: createdName, raw };
    } finally {
      await cleanup().catch(() => undefined);
    }
  }

  async status(handle: Handle): Promise<Status> {
    const raw = handle.raw as K8sHandleRaw;
    const job = await this.kubectl(['get', 'job', raw.jobName, '-o', 'json'], raw);
    const st = job?.status ?? {};
    const state = mapJobState(st);
    // A Job doesn't carry the container exit code; surface 0/1 by terminal state
    // so callers relying on exitCode still get a sensible success/failure signal.
    const exitCode = state === 'succeeded' ? 0 : state === 'failed' ? 1 : undefined;
    return {
      state,
      exitCode,
      startedAt: parseDate(st.startTime),
      finishedAt: parseDate(st.completionTime),
    };
  }

  logs(handle: Handle): AsyncIterable<LogLine> {
    const raw = handle.raw as K8sHandleRaw;
    // `job/<name>` follows the job's pod. --pod-running-timeout makes kubectl WAIT
    // for the container to reach Running before streaming, then follow to
    // completion — NOT --ignore-errors, which (proven by the kind e2e) demotes the
    // "ContainerCreating" state to a swallowed error and makes --follow give up
    // in ~40ms when logs are opened right after launch.
    //
    // Trade-off (flipped failure contract): a pod that NEVER reaches Running
    // (ImagePullBackOff / unschedulable) blocks this stream for the whole timeout
    // before erroring. That's a finite, tunable bound — set
    // target.extra.logs_pod_running_timeout lower for headless orchestration that
    // awaits logs before polling status. (status() can't shorten it: the Job
    // keeps a stuck pod `active`, so it also reads `running` until backoffLimit.)
    const timeout = raw.logsPodRunningTimeout ?? LOG_POD_RUNNING_TIMEOUT;
    const args = nsArgs(
      ['logs', `job/${raw.jobName}`, '--follow', '--all-containers', `--pod-running-timeout=${timeout}`],
      raw,
    );
    return this.stream(this.bin, args);
  }

  async exec(handle: Handle, argv: string[]): Promise<ExecResult> {
    const raw = handle.raw as K8sHandleRaw;
    // Resolve the job's (first) pod, then exec into it.
    const pods = await this.kubectl(
      ['get', 'pods', '-l', `job-name=${raw.jobName}`, '-o', 'jsonpath={.items[0].metadata.name}'],
      raw,
      { raw: true },
    );
    const pod = String(pods).trim();
    if (!pod) throw new Error(`kubernetes exec: no pod found for job ${raw.jobName}`);
    // kubectl flags (`--namespace`/`--context`) MUST precede the `--` separator,
    // or they'd be passed as arguments to the exec'd command instead.
    const { code, stdout, stderr } = await this.run(
      this.bin,
      [...nsArgs(['exec', pod], raw), '--', ...argv],
    );
    return { exitCode: code, stdout, stderr };
  }

  async stop(handle: Handle): Promise<void> {
    const raw = handle.raw as K8sHandleRaw;
    // Delete the Job and its pods; don't block teardown waiting for finalizers.
    await this.run(this.bin, nsArgs(['delete', 'job', raw.jobName, '--wait=false', '--ignore-not-found'], raw));
  }

  /** Build the batch/v1 Job manifest (pure → unit-tested). */
  buildJobManifest(
    spec: TaskSpec,
    opts: { jobName: string; namespace: string; extra: Record<string, unknown> },
  ): Record<string, unknown> {
    const env = Object.entries(spec.env ?? {}).map(([name, value]) => ({ name, value }));
    const labels = sanitizeLabels(spec.labels);

    const container: Record<string, unknown> = {
      name: this.namePrefix,
      image: spec.image,
      env,
      imagePullPolicy: 'IfNotPresent',
    };
    if (spec.command?.length) container.command = spec.command;
    const resources = k8sResources(spec.resources);
    if (resources) container.resources = resources;

    const podSpec: Record<string, unknown> = {
      restartPolicy: 'Never',
      containers: [container],
    };
    if (opts.extra.service_account) podSpec.serviceAccountName = String(opts.extra.service_account);
    if (opts.extra.image_pull_secret) podSpec.imagePullSecrets = [{ name: String(opts.extra.image_pull_secret) }];

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: opts.jobName, namespace: opts.namespace, labels },
      spec: {
        backoffLimit: 0, // one shot: don't silently re-run the agent on failure
        ttlSecondsAfterFinished: 3600, // let the cluster GC finished jobs after 1h
        template: {
          metadata: { labels: { ...labels, 'job-name': opts.jobName } },
          spec: podSpec,
        },
      },
    };
  }

  /** Run a kubectl subcommand; parse JSON stdout unless `raw`. */
  private async kubectl(
    args: string[],
    scope: { namespace: string; context?: string },
    opts: { raw?: boolean } = {},
  ): Promise<any> {
    const full = nsArgs(args, scope);
    const { code, stdout, stderr } = await this.run(this.bin, full);
    if (code !== 0) {
      throw new Error(`kubectl ${args.slice(0, 2).join(' ')} failed (${code}): ${stderr.trim() || stdout.trim()}`);
    }
    if (opts.raw) return stdout;
    if (!stdout.trim()) return {};
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`kubectl ${args.slice(0, 2).join(' ')}: could not parse JSON output`);
    }
  }
}

/** Append `--namespace` (+ optional `--context`) to a kubectl argv. Pure. */
function nsArgs(args: string[], scope: { namespace: string; context?: string }): string[] {
  const out = [...args, '--namespace', scope.namespace];
  if (scope.context) out.push('--context', scope.context);
  return out;
}

/** Map a Job `.status` to the neutral TaskState. */
export function mapJobState(status: { succeeded?: number; failed?: number; active?: number }): Status['state'] {
  if (status.succeeded && status.succeeded > 0) return 'succeeded';
  if (status.failed && status.failed > 0) return 'failed';
  if (status.active && status.active > 0) return 'running';
  return 'pending'; // created, no pod scheduled yet
}

/** TaskSpec.resources → k8s requests/limits, or undefined if nothing set. */
export function k8sResources(resources?: TaskSpec['resources']): Record<string, unknown> | undefined {
  if (!resources || (!resources.cpu && !resources.memoryMB)) return undefined;
  const req: Record<string, string> = {};
  if (resources.cpu) req.cpu = cpuQuantity(resources.cpu);
  if (resources.memoryMB) req.memory = `${Math.round(resources.memoryMB)}Mi`;
  // requests == limits: the agent box should get what it asks for, and a hard
  // memory limit prevents one runaway task from evicting neighbours.
  return { requests: { ...req }, limits: { ...req } };
}

/** vCPU count → k8s CPU quantity (fractional → milliCPU). */
function cpuQuantity(cpu: number): string {
  if (cpu < 1) return `${Math.round(cpu * 1000)}m`;
  return String(cpu);
}

/** Labels must be valid k8s label values (alphanumeric, '-', '_', '.', <=63). A
 *  label that can't be encoded is dropped rather than failing the launch. */
function sanitizeLabels(labels?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels ?? {})) {
    const key = k.replace(/[^A-Za-z0-9._/-]/g, '_');
    const val = v.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 63);
    if (key && val) out[key] = val;
  }
  return out;
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** Default manifest writer: a temp dir with the JSON, cleaned up after apply. */
const defaultManifestWriter: ManifestWriter = async (content) => {
  const dir = await mkdtemp(join(tmpdir(), 'nemus-k8s-'));
  const path = join(dir, 'job.json');
  await writeFile(path, content, 'utf8');
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
};

/** `kubectl logs -f` streamer (line-split stdout/stderr). */
const defaultKubectlStream: LogStreamer = async function* (bin, args) {
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
  if (failure) throw new Error(`kubectl logs stream failed: ${failure.message}`);
};
