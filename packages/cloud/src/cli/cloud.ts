#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createProvisioner, provisionerNames } from '../provision/registry';
import { iacModuleDir, listIacModules } from '../provision/modules';
import { createRunner, runnerNames } from '../runner/registry';
import { registeredForges } from '../gitforge/registry';
import { Capabilities, TargetDescriptor, TaskSpec } from '../runner/types';

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
  runnerNames: () => string[];
  provisionerNames: () => string[];
  registeredForges: () => string[];
  listIacModules: () => string[];
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
  runnerNames,
  provisionerNames,
  registeredForges,
  listIacModules,
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

  const taskEnv: Record<string, string> = {
    NEMUS_REPOS: repos,
    NEMUS_TASK: task,
    NEMUS_AGENT: agent,
    REPORT_MODE: report,
  };
  if (owner) taskEnv.NEMUS_OWNER = owner;
  if (str(flags, 'git-host')) taskEnv.GIT_HOST = str(flags, 'git-host')!;
  injectForgeEnv(taskEnv, env, 'run');

  const cpu = str(flags, 'cpu');
  const memory = str(flags, 'memory');
  const resources =
    cpu || memory ? { cpu: cpu ? Number(cpu) : undefined, memoryMB: memory ? Number(memory) : undefined } : undefined;

  // Labels must be tag-safe (no commas) — so NEVER put the repo list here.
  const labels: Record<string, string> = { 'nemus.agent': agent };
  if (owner) labels['nemus.owner'] = owner;

  return { image, env: taskEnv, command: ['nemus-cloud-agent'], resources, labels };
}

/** Build the TaskSpec for `fix-pr` mode: drive an EXISTING PR to green (no new
 *  PR). Pure + exported so the env contract is unit-tested. */
export function buildFixPrTaskSpec(flags: Flags, env: NodeJS.ProcessEnv): TaskSpec {
  const image = str(flags, 'image');
  const repo = str(flags, 'repo') ?? str(flags, 'repos');
  const pr = str(flags, 'pr');
  const branch = str(flags, 'branch');
  if (!image) throw new Error('fix-pr: --image is required');
  if (!repo) throw new Error('fix-pr: --repo owner/name is required');
  if (repo.includes(',')) throw new Error('fix-pr: exactly one --repo (no comma-separated list)');
  if (!pr) throw new Error('fix-pr: --pr <number> is required');
  if (!/^\d+$/.test(pr)) throw new Error(`fix-pr: --pr must be a number, got "${pr}"`);
  if (!branch) throw new Error('fix-pr: --branch <pr-head> is required');

  const agent = str(flags, 'agent') ?? 'pi';
  const owner = str(flags, 'owner');
  const taskEnv: Record<string, string> = {
    NEMUS_MODE: 'fix-pr',
    NEMUS_REPOS: repo,
    NEMUS_PR_NUMBER: pr,
    NEMUS_PR_BRANCH: branch,
    NEMUS_AGENT: agent,
  };
  if (owner) taskEnv.NEMUS_OWNER = owner;
  if (str(flags, 'task')) taskEnv.NEMUS_TASK = str(flags, 'task')!;
  if (str(flags, 'git-host')) taskEnv.GIT_HOST = str(flags, 'git-host')!;
  for (const [flag, envKey] of [
    ['max-iterations', 'NEMUS_CI_MAX_ITERATIONS'],
    ['poll-interval-ms', 'NEMUS_CI_POLL_INTERVAL_MS'],
    ['max-polls', 'NEMUS_CI_MAX_POLLS'],
  ] as const) {
    if (str(flags, flag)) taskEnv[envKey] = str(flags, flag)!;
  }
  injectForgeEnv(taskEnv, env, 'fix-pr');

  const cpu = str(flags, 'cpu');
  const memory = str(flags, 'memory');
  const resources =
    cpu || memory ? { cpu: cpu ? Number(cpu) : undefined, memoryMB: memory ? Number(memory) : undefined } : undefined;

  const labels: Record<string, string> = { 'nemus.agent': agent, 'nemus.mode': 'fix-pr', 'nemus.pr': pr };
  if (owner) labels['nemus.owner'] = owner;

  return { image, env: taskEnv, command: ['nemus-cloud-agent'], resources, labels };
}

/**
 * Inject forge auth + code-host selector + notifier sinks into a task env,
 * shared by `run` and `fix-pr`. Requires forge auth (a token or App creds) and
 * passes through the code-host / API-base / notifier vars when set, so the
 * container can target GitHub or GitLab and report back out-of-band.
 */
function injectForgeEnv(taskEnv: Record<string, string>, env: NodeJS.ProcessEnv, cmd: string): void {
  const token = env.GITHUB_TOKEN || env.GIT_TOKEN;
  const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID);
  if (!token && !hasApp) {
    throw new Error(`${cmd}: no forge auth — set GITHUB_TOKEN (or GITHUB_APP_ID/_PRIVATE_KEY/_INSTALLATION_ID)`);
  }
  if (token) taskEnv.GITHUB_TOKEN = token;
  // Least-privilege in-task auth (App) + code-host selector + notifier sinks.
  for (const k of [
    'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID',
    'NEMUS_FORGE', 'NEMUS_FORGE_HOST', 'GITHUB_API_URL', 'GITLAB_API_URL',
    'SLACK_WEBHOOK_URL', 'NEMUS_WEBHOOK_URL',
  ]) {
    if (env[k]) taskEnv[k] = env[k]!;
  }
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
  return launchSpec(buildRunTaskSpec(flags, deps.env), flags, deps);
}

async function cmdFixPr(flags: Flags, deps: CloudCliDeps): Promise<number> {
  return launchSpec(buildFixPrTaskSpec(flags, deps.env), flags, deps);
}

/** Launch a TaskSpec on the resolved target, with optional --follow / --wait. */
async function launchSpec(spec: TaskSpec, flags: Flags, deps: CloudCliDeps): Promise<number> {
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

// ------------------------------------------------------------- runners/list

export interface RegistrySnapshot {
  runners: Array<{ name: string; capabilities: Capabilities | null; error?: string }>;
  provisioners: string[];
  forges: string[];
  modules: Array<{ name: string; runner: string | null }>;
}

/** Read every registry (+ each runner's declared Capabilities, + each shipped
 *  module's target runner) into a plain object. Pure over the injected deps, so
 *  it's unit-tested without touching real backends. */
export function collectRegistry(deps: CloudCliDeps): RegistrySnapshot {
  const runners = deps.runnerNames().sort().map((name) => {
    try {
      return { name, capabilities: deps.createRunner(name).capabilities };
    } catch (e) {
      return { name, capabilities: null, error: (e as Error).message };
    }
  });
  const modules = deps.listIacModules().map((name) => ({ name, runner: moduleRunner(deps, name) }));
  return {
    runners,
    provisioners: deps.provisionerNames().sort(),
    forges: deps.registeredForges().sort(),
    modules,
  };
}

/** Best-effort: read a shipped module's `outputs.tf` and pull out the runner it
 *  targets. Our modules emit a single `output "target"` whose value MAP carries a
 *  `runner = "..."` entry (see each module's outputs.tf) — NOT the block form
 *  `output "runner" { value = ... }` — so a flat `runner = "..."` match is
 *  correct here (guarded against the real files by a test). Returns null if
 *  unreadable, so a hand-written module without the entry just omits the arrow. */
function moduleRunner(deps: CloudCliDeps, name: string): string | null {
  try {
    const tf = deps.readFile(`${deps.iacModuleDir(name)}/outputs.tf`);
    return /\brunner\s*=\s*"([a-z0-9-]+)"/i.exec(tf)?.[1] ?? null;
  } catch {
    return null;
  }
}

const CAP_KEYS: Array<[keyof Capabilities, string]> = [
  ['exec', 'exec'],
  ['logStream', 'logs'],
  ['portForward', 'port'],
  ['persistentDisk', 'disk'],
  ['secretStore', 'secrets'],
];

function cmdRunners(flags: Flags, deps: CloudCliDeps): number {
  const snap = collectRegistry(deps);
  if (bool(flags, 'json')) {
    deps.log(JSON.stringify(snap, null, 2));
    return 0;
  }
  const tick = (b: boolean) => (b ? 'yes' : ' - ');
  const width = Math.max(6, ...snap.runners.map((r) => r.name.length));
  deps.log('Runners (where a task executes):');
  for (const r of snap.runners) {
    if (!r.capabilities) {
      deps.log(`  ${r.name.padEnd(width)}  (unavailable: ${r.error})`);
      continue;
    }
    const caps = CAP_KEYS.map(([k, label]) => `${label} ${tick(r.capabilities![k])}`).join('  ');
    deps.log(`  ${r.name.padEnd(width)}  ${caps}`);
  }
  deps.log('');
  deps.log(`Provisioners (stand up a target):  ${snap.provisioners.join(', ') || '(none)'}`);
  deps.log(`Git forges (code host):            ${snap.forges.join(', ') || '(none)'}`);
  deps.log('');
  deps.log('Shipped IaC modules (nemus-cloud up --module <name>):');
  if (snap.modules.length === 0) deps.log('  (none)');
  for (const m of snap.modules) {
    deps.log(`  ${m.name}${m.runner ? ` → ${m.runner} runner` : ''}`);
  }
  return 0;
}

const USAGE = `nemus-cloud — provision + run Nemus agents on your own infra

Usage:
  nemus-cloud runners [--json]                     list runners + capabilities, provisioners, modules, forges
  nemus-cloud up    --module <name|--module-dir dir> [--var k=v]... [--provisioner opentofu] [--out FILE]
  nemus-cloud down  [--target FILE] --module <name|--module-dir dir> [--var k=v]...
  nemus-cloud run   --image REF --repos a,b --task "..." [--target FILE]
                    [--agent pi] [--owner ORG] [--report pr|none] [--cpu N] [--memory MB]
                    [--git-host HOST] [--follow] [--wait]
  nemus-cloud fix-pr --image REF --repo owner/name --pr N --branch HEAD [--target FILE]
                    [--agent pi] [--owner ORG] [--task "..."] [--git-host HOST]
                    [--max-iterations N] [--poll-interval-ms N] [--max-polls N]
                    [--cpu N] [--memory MB] [--follow] [--wait]

Forge auth for \`run\`/\`fix-pr\` comes from the environment: GITHUB_TOKEN, or
GITHUB_APP_ID/_PRIVATE_KEY/_INSTALLATION_ID. Target a different host with
NEMUS_FORGE_HOST=gitlab (+ GITLAB_API_URL); report out-of-band with
SLACK_WEBHOOK_URL / NEMUS_WEBHOOK_URL.`;

export async function main(argv: string[], deps: CloudCliDeps = defaultDeps): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  try {
    switch (cmd) {
      case 'runners':
      case 'ls':
        return cmdRunners(flags, deps);
      case 'up':
        return await cmdUp(flags, deps);
      case 'down':
        return await cmdDown(flags, deps);
      case 'run':
        return await cmdRun(flags, deps);
      case 'fix-pr':
        return await cmdFixPr(flags, deps);
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
