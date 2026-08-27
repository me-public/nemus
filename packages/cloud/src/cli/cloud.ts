#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createProvisioner } from '../provision/registry';
import { iacModuleDir } from '../provision/modules';
import { createRunner } from '../runner/registry';
import { TargetDescriptor, TaskSpec } from '../runner/types';

/**
 * `nemus-cloud` — the thin CLI that ties the P2 seams together:
 *   up    provision a target (Provisioner)         -> writes a descriptor file
 *   down  tear a target down (Provisioner)
 *   run   launch the agent image on a target (Runner) + stream logs / wait
 *
 * Dependency-free (hand-rolled arg parsing; the core CLI's commander stays out
 * of this zero-dep package). All I/O is injected so the logic is unit-tested.
 */

const DEFAULT_TARGET_FILE = '.nemus-target.json';

export interface CloudCliDeps {
  createProvisioner: typeof createProvisioner;
  createRunner: typeof createRunner;
  iacModuleDir: (name: string) => string;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  log: (s: string) => void;
  errlog: (s: string) => void;
  env: NodeJS.ProcessEnv;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: CloudCliDeps = {
  createProvisioner,
  createRunner,
  iacModuleDir,
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, c) => writeFileSync(p, c),
  log: (s) => process.stdout.write(s + '\n'),
  errlog: (s) => process.stderr.write(s + '\n'),
  env: process.env,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// ---------------------------------------------------------------- arg parsing

export type Flags = Record<string, string | string[] | boolean>;
export interface ParsedArgs {
  cmd: string | undefined;
  positionals: string[];
  flags: Flags;
}

/** Tiny parser: `--k v`, `--k=v`, repeated `--k` → array, bare `--k` → true. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!tok.startsWith('--')) {
      positionals.push(tok);
      continue;
    }
    const body = tok.slice(2);
    let key: string;
    let val: string | boolean;
    const eq = body.indexOf('=');
    if (eq !== -1) {
      key = body.slice(0, eq);
      val = body.slice(eq + 1);
    } else {
      key = body;
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = true;
      }
    }
    const existing = flags[key];
    if (existing === undefined) flags[key] = val;
    else if (Array.isArray(existing)) existing.push(String(val));
    else flags[key] = [String(existing), String(val)];
  }
  return { cmd, positionals, flags };
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  if (v === undefined || typeof v === 'boolean') return undefined;
  return Array.isArray(v) ? v[v.length - 1] : v;
}

function multi(flags: Flags, key: string): string[] {
  const v = flags[key];
  if (v === undefined || typeof v === 'boolean') return [];
  return Array.isArray(v) ? v : [v];
}

function bool(flags: Flags, key: string): boolean {
  return flags[key] === true || flags[key] === 'true';
}

/** `["k=v", "a=b"]` → `{ k: 'v', a: 'b' }`. */
export function parseVars(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list) {
    const eq = item.indexOf('=');
    if (eq === -1) throw new Error(`--var "${item}" must be key=value`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

// -------------------------------------------------------------- run TaskSpec

/** Build the agent TaskSpec (image + the runner-image env contract) from flags.
 *  Pure + exported so the env wiring is unit-tested. */
export function buildRunTaskSpec(flags: Flags, env: NodeJS.ProcessEnv): TaskSpec {
  const image = str(flags, 'image');
  const repos = str(flags, 'repos');
  const task = str(flags, 'task');
  if (!image) throw new Error('run: --image is required');
  if (!repos) throw new Error('run: --repos is required (comma-separated)');
  if (!task) throw new Error('run: --task is required');

  const agent = str(flags, 'agent') ?? 'pi';
  const owner = str(flags, 'owner');
  const report = str(flags, 'report') ?? 'pr';
  const token = env.GITHUB_TOKEN || env.GIT_TOKEN;
  const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID);
  if (!token && !hasApp) {
    throw new Error('run: no forge auth — set GITHUB_TOKEN (or GITHUB_APP_ID/_PRIVATE_KEY/_INSTALLATION_ID)');
  }

  const taskEnv: Record<string, string> = {
    NEMUS_REPOS: repos,
    NEMUS_TASK: task,
    NEMUS_AGENT: agent,
    REPORT_MODE: report,
  };
  if (owner) taskEnv.NEMUS_OWNER = owner;
  if (str(flags, 'git-host')) taskEnv.GIT_HOST = str(flags, 'git-host')!;
  if (token) taskEnv.GITHUB_TOKEN = token;
  // Pass App creds straight through when present (least-privilege in-task auth).
  for (const k of ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID']) {
    if (env[k]) taskEnv[k] = env[k]!;
  }

  const cpu = str(flags, 'cpu');
  const memory = str(flags, 'memory');
  const resources =
    cpu || memory ? { cpu: cpu ? Number(cpu) : undefined, memoryMB: memory ? Number(memory) : undefined } : undefined;

  // Labels must be tag-safe (no commas) — so NEVER put the repo list here.
  const labels: Record<string, string> = { 'nemus.agent': agent };
  if (owner) labels['nemus.owner'] = owner;

  return { image, env: taskEnv, command: ['nemus-cloud-agent'], resources, labels };
}

function loadTarget(deps: CloudCliDeps, file: string): TargetDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFile(file));
  } catch {
    throw new Error(`could not read target descriptor "${file}" (run \`nemus-cloud up\` first?)`);
  }
  const t = parsed as Partial<TargetDescriptor>;
  if (!t || t.version !== 1 || typeof t.runner !== 'string' || !t.runner) {
    throw new Error(`"${file}" is not a valid TargetDescriptor (need { version: 1, runner })`);
  }
  return t as TargetDescriptor;
}

function resolveModuleDir(deps: CloudCliDeps, flags: Flags): string {
  const dir = str(flags, 'module-dir');
  if (dir) return dir;
  const name = str(flags, 'module');
  if (name) return deps.iacModuleDir(name);
  throw new Error('provide --module <name> (a shipped module) or --module-dir <path>');
}

// ------------------------------------------------------------------ commands

async function cmdUp(flags: Flags, deps: CloudCliDeps): Promise<number> {
  const moduleDir = resolveModuleDir(deps, flags);
  const vars = parseVars(multi(flags, 'var'));
  const p = deps.createProvisioner(str(flags, 'provisioner') ?? 'opentofu', { moduleDir, vars });
  const target = await p.up({});
  const out = str(flags, 'out') ?? DEFAULT_TARGET_FILE;
  deps.writeFile(out, JSON.stringify(target, null, 2));
  deps.log(`provisioned ${target.runner} → wrote ${out}`);
  return 0;
}

async function cmdDown(flags: Flags, deps: CloudCliDeps): Promise<number> {
  const file = str(flags, 'target') ?? DEFAULT_TARGET_FILE;
  const target = loadTarget(deps, file);
  const moduleDir = resolveModuleDir(deps, flags);
  const vars = parseVars(multi(flags, 'var'));
  const p = deps.createProvisioner(str(flags, 'provisioner') ?? 'opentofu', { moduleDir, vars });
  await p.down(target);
  deps.log(`destroyed ${target.runner}`);
  return 0;
}

async function cmdRun(flags: Flags, deps: CloudCliDeps): Promise<number> {
  const spec = buildRunTaskSpec(flags, deps.env);
  const target = loadTarget(deps, str(flags, 'target') ?? DEFAULT_TARGET_FILE);
  const runner = deps.createRunner(target.runner);
  const handle = await runner.launch(spec, target);
  deps.log(`launched ${handle.runner} task ${handle.id}`);

  if (bool(flags, 'follow')) {
    for await (const line of runner.logs(handle)) deps.log(line.line);
  }
  if (bool(flags, 'wait')) {
    for (;;) {
      const st = await runner.status(handle);
      if (st.state === 'succeeded' || st.state === 'failed' || st.state === 'stopped') {
        deps.log(`task ${st.state}${st.exitCode !== undefined ? ` (exit ${st.exitCode})` : ''}`);
        return st.state === 'succeeded' ? 0 : 1;
      }
      await deps.sleep(5000);
    }
  }
  return 0;
}

const USAGE = `nemus-cloud — provision + run Nemus agents on your own infra

Usage:
  nemus-cloud up    --module <name|--module-dir dir> [--var k=v]... [--provisioner opentofu] [--out FILE]
  nemus-cloud down  [--target FILE] --module <name|--module-dir dir> [--var k=v]...
  nemus-cloud run   --image REF --repos a,b --task "..." [--target FILE]
                    [--agent pi] [--owner ORG] [--report pr|none] [--cpu N] [--memory MB]
                    [--git-host HOST] [--follow] [--wait]

Forge auth for \`run\` comes from the environment: GITHUB_TOKEN, or
GITHUB_APP_ID/_PRIVATE_KEY/_INSTALLATION_ID.`;

export async function main(argv: string[], deps: CloudCliDeps = defaultDeps): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  try {
    switch (cmd) {
      case 'up':
        return await cmdUp(flags, deps);
      case 'down':
        return await cmdDown(flags, deps);
      case 'run':
        return await cmdRun(flags, deps);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        deps.log(USAGE);
        return cmd === undefined ? 1 : 0;
      default:
        deps.errlog(`unknown command "${cmd}"\n\n${USAGE}`);
        return 1;
    }
  } catch (e) {
    deps.errlog(`nemus-cloud: ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`nemus-cloud: fatal: ${e}\n`);
      process.exit(1);
    });
}
