/**
 * The execution seam. Core orchestration is written ONLY against these types —
 * it never imports a cloud SDK. A backend is anything that can "run an OCI image
 * with env and stream logs": local Docker, Fly, Fargate, Cloud Run, k8s, a VM.
 *
 * Litmus test for every addition here: "Would this still compile if the only
 * backend were a local Docker socket?"
 */

/** What a backend can do. Features degrade gracefully on what's missing, rather
 *  than the design bending to the weakest backend. */
export interface Capabilities {
  /** Run a command inside a live task (docker exec / kubectl exec / …). */
  exec: boolean;
  /** Stream logs while the task runs (vs. only after it exits). */
  logStream: boolean;
  /** Attach a persistent disk/volume across task restarts. */
  persistentDisk: boolean;
  /** Backend has a native secret store (else secrets must be pre-resolved to env). */
  secretStore: boolean;
  /** Forward a local port to a port in the task. */
  portForward: boolean;
}

/** A reference to a secret, resolved by a SecretSource before launch when the
 *  backend has no native secret store. */
export interface SecretRef {
  /** Env var name to expose the resolved value as. */
  name: string;
  /** Opaque locator understood by the chosen SecretSource, e.g. "dotenv:GIT_TOKEN". */
  from: string;
}

/** 100% provider-neutral description of one task to run. */
export interface TaskSpec {
  /** OCI image reference. The image is the portability boundary. */
  image: string;
  /** Environment variables passed to the task. */
  env?: Record<string, string>;
  /** Secrets to resolve + inject (backends without secretStore expect these
   *  already merged into `env` by the orchestrator). */
  secrets?: SecretRef[];
  /** Override the image's default command. */
  command?: string[];
  /** Resource request. */
  resources?: { cpu?: number; memoryMB?: number; diskGB?: number };
  /** Labels/tags for discovery + ownership. */
  labels?: Record<string, string>;
}

/**
 * The small, versioned, serializable contract between provisioning (IaC) and
 * execution. Provision once → run many; or hand-write one to bring your own
 * infra and skip IaC entirely.
 */
export interface TargetDescriptor {
  version: 1;
  /** Which runner this target is for: 'docker' | 'fly' | 'aws-fargate' | … */
  runner: string;
  region?: string;
  endpoint?: string;
  cluster?: string;
  secretBackend?: string;
  /** Backend-specific extras (kept out of the generic core). */
  extra?: Record<string, unknown>;
}

/** Opaque handle to a launched task, returned by a Runner. */
export interface Handle {
  runner: string;
  /** Backend-native id (container id, task ARN, pod name, …). */
  id: string;
  /** Backend-native details, for debugging; never relied on by core. */
  raw?: unknown;
}

export type TaskState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'unknown';

export interface Status {
  state: TaskState;
  exitCode?: number;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface LogLine {
  stream: 'stdout' | 'stderr';
  line: string;
  ts?: Date;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs one task on some backend. The only execution seam core depends on. */
export interface Runner {
  readonly id: string;
  readonly capabilities: Capabilities;
  launch(spec: TaskSpec, target: TargetDescriptor): Promise<Handle>;
  status(handle: Handle): Promise<Status>;
  logs(handle: Handle): AsyncIterable<LogLine>;
  /** Present only when `capabilities.exec` is true. */
  exec?(handle: Handle, argv: string[]): Promise<ExecResult>;
  stop(handle: Handle): Promise<void>;
}

/** Stands up (and tears down) a place that can run tasks. Slow, stateful, rare —
 *  deliberately split from the fast, ephemeral Runner. */
export interface Provisioner {
  readonly id: string;
  up(config: Record<string, unknown>): Promise<TargetDescriptor>;
  down(target: TargetDescriptor): Promise<void>;
}
