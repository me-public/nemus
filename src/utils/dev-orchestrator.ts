import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { colorize, type ColorName } from './colors';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

/** Detect a repo's package manager from its lockfile (defaults to npm). */
export function detectPackageManager(repoPath: string): PackageManager {
  if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** Default script preference order when the user doesn't pass --script. */
export const DEFAULT_SCRIPT_ORDER = ['dev', 'develop', 'start', 'serve'] as const;

/**
 * Pick the dev script to run from a package.json `scripts` map. If `preferred`
 * is given and present, it wins; otherwise the first of DEFAULT_SCRIPT_ORDER
 * that exists. Returns null when nothing matches.
 */
export function pickDevScript(
  scripts: Record<string, string> | undefined,
  preferred?: string
): string | null {
  if (!scripts) return null;
  if (preferred) return scripts[preferred] ? preferred : null;
  for (const name of DEFAULT_SCRIPT_ORDER) {
    if (scripts[name]) return name;
  }
  return null;
}

/** The command string a package manager uses to run a script. */
export function scriptRunCommand(pm: PackageManager, script: string): string {
  // npm needs `run`; yarn/pnpm accept the bare script name.
  return pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`;
}

export interface DevCommand {
  /** Full shell command string to run in the repo. */
  command: string;
  /** How it was chosen, for the startup banner. */
  source: string;
}

/**
 * Resolve the command to run for a repo. An explicit `commandOverride` always
 * wins; otherwise we read package.json and pick a script. Returns null when the
 * repo has nothing runnable (e.g. a library with no dev script).
 */
export function resolveDevCommand(
  repoPath: string,
  opts: { commandOverride?: string; script?: string } = {}
): DevCommand | null {
  if (opts.commandOverride) {
    return { command: opts.commandOverride, source: 'command' };
  }

  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  let scripts: Record<string, string> | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    scripts = pkg?.scripts;
  } catch {
    return null;
  }

  const script = pickDevScript(scripts, opts.script);
  if (!script) return null;

  const pm = detectPackageManager(repoPath);
  return { command: scriptRunCommand(pm, script), source: `${pm} · ${script}` };
}

/** Palette used to color per-repo prefixes (cycled if there are more repos). */
export const PREFIX_COLORS: ColorName[] = [
  'cyan', 'green', 'yellow', 'magenta', 'blue', 'red', 'white',
];

export function assignColors(names: string[]): Map<string, ColorName> {
  const map = new Map<string, ColorName>();
  names.forEach((name, i) => map.set(name, PREFIX_COLORS[i % PREFIX_COLORS.length]));
  return map;
}

/** Build the aligned, colored `"label | "` prefix for a service's output. */
export function formatPrefix(label: string, width: number, color: ColorName): string {
  return colorize(`${label.padEnd(width)} ${colorize('|', 'gray')}`, color);
}

/**
 * Stateful line splitter: feed it chunks, it returns complete lines and holds
 * the trailing partial until the next chunk. `flush()` yields any remainder.
 */
export function createLineSplitter() {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines;
    },
    flush(): string | null {
      if (buffer.length === 0) return null;
      const rest = buffer;
      buffer = '';
      return rest;
    },
  };
}

export interface DevService {
  label: string;
  cwd: string;
  command: DevCommand;
}

export interface RunDevOptions {
  exitOnFailure?: boolean;
  killTimeoutMs?: number;
  /** Injectable sinks + spawn for testing; default to real stdout/stderr/spawn. */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  spawnFn?: typeof spawn;
  /** Register a signal handler; returns a disposer. Injected for tests. */
  onSignal?: (handler: (sig: NodeJS.Signals) => void) => () => void;
  /** How to signal a child's process group. Injected for tests. */
  killFn?: (child: ChildProcess, signal: NodeJS.Signals) => void;
}

interface RunningService {
  service: DevService;
  child: ChildProcess;
  exited: boolean;
  exitCode: number | null;
}

/**
 * Start every service, multiplex their output with colored prefixes, and drive a
 * clean shutdown on Ctrl-C. Resolves with the exit code to use (first non-zero
 * child code, or 0) once all services have exited.
 */
export function runDev(services: DevService[], opts: RunDevOptions = {}): Promise<number> {
  const out = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const spawnFn = opts.spawnFn ?? spawn;
  const killTimeoutMs = opts.killTimeoutMs ?? 5000;
  const kill = opts.killFn ?? killGroup;
  const width = Math.max(...services.map(s => s.label.length), 1);
  const colors = assignColors(services.map(s => s.label));

  return new Promise<number>((resolve) => {
    const running: RunningService[] = [];
    let shuttingDown = false;
    let finished = false;
    let firstFailureCode = 0;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let disposeSignals: () => void = () => {};

    const writePrefixed = (
      sink: NodeJS.WritableStream,
      label: string,
      text: string
    ) => {
      const prefix = formatPrefix(label, width, colors.get(label) ?? 'white');
      sink.write(`${prefix} ${text}\n`);
    };

    // SIGKILL every started service's process GROUP. Unconditional by design: a
    // detached leader (the shell) can exit on SIGTERM while its group still has
    // living members (e.g. a grandchild that ignores SIGTERM) — gating on the
    // leader having exited is exactly what leaks orphans. kill(-pid) on an empty
    // group is a harmless ESRCH.
    const sigkillSweep = () => {
      for (const r of running) kill(r.child, 'SIGKILL');
    };

    const finalize = () => {
      if (finished) return;
      finished = true;
      if (killTimer) clearTimeout(killTimer);
      disposeSignals();
      resolve(firstFailureCode);
    };

    const maybeFinish = () => {
      if (!running.every(r => r.exited)) return;
      // All direct children are gone. If we were shutting down, force-reap any
      // orphaned group members (detached grandchildren) before finishing —
      // otherwise we'd exit and leave them running.
      if (shuttingDown) sigkillSweep();
      finalize();
    };

    const shutdown = (reason: string) => {
      if (shuttingDown) {
        // Second Ctrl-C: escalate immediately.
        sigkillSweep();
        return;
      }
      shuttingDown = true;
      err.write(`\n${colorize(`▸ ${reason} — stopping ${running.filter(r => !r.exited).length} service(s)…`, 'yellow')}\n`);
      for (const r of running) kill(r.child, 'SIGTERM');
      // Backstop: SIGKILL anything still alive after the grace period, then finish.
      killTimer = setTimeout(() => {
        sigkillSweep();
        finalize();
      }, killTimeoutMs);
      if (typeof killTimer.unref === 'function') killTimer.unref();
    };

    disposeSignals = (opts.onSignal ?? defaultOnSignal)((sig) => shutdown(`received ${sig}`));

    for (const service of services) {
      const child = spawnFn(service.command.command, {
        cwd: service.cwd,
        shell: true,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      const rec: RunningService = { service, child, exited: false, exitCode: null };
      running.push(rec);

      const outSplitter = createLineSplitter();
      const errSplitter = createLineSplitter();
      child.stdout?.setEncoding('utf-8');
      child.stderr?.setEncoding('utf-8');
      child.stdout?.on('data', (chunk: string) => {
        for (const line of outSplitter.push(chunk)) writePrefixed(out, service.label, line);
      });
      child.stderr?.on('data', (chunk: string) => {
        for (const line of errSplitter.push(chunk)) writePrefixed(err, service.label, line);
      });

      child.on('error', (e) => {
        writePrefixed(err, service.label, colorize(`failed to start: ${e.message}`, 'red'));
        rec.exited = true;
        rec.exitCode = 1;
        if (firstFailureCode === 0) firstFailureCode = 1;
        maybeFinish();
      });

      child.on('exit', (code, signal) => {
        for (const line of [outSplitter.flush(), errSplitter.flush()]) {
          if (line) writePrefixed(out, service.label, line);
        }
        rec.exited = true;
        rec.exitCode = code ?? (signal ? 0 : 1);
        const desc = signal ? `signal ${signal}` : `code ${code}`;
        const color = code && code !== 0 ? 'red' : 'gray';
        err.write(`${colorize(`▸ ${service.label} exited (${desc})`, color)}\n`);
        if (code && code !== 0 && firstFailureCode === 0) firstFailureCode = code;
        if (!shuttingDown && opts.exitOnFailure && code && code !== 0) {
          shutdown(`${service.label} failed`);
        }
        maybeFinish();
      });
    }

    if (running.length === 0) finalize();
  });
}

/** Kill a detached child's whole process group, falling back to the pid. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function defaultOnSignal(handler: (sig: NodeJS.Signals) => void): () => void {
  const onSigint = () => handler('SIGINT');
  const onSigterm = () => handler('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  return () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  };
}
