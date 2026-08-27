import { Exec, run, shellExec } from '../agent/exec';
import { Provisioner, TargetDescriptor } from '../runner/types';

export interface OpenTofuProvisionerOptions {
  /** Directory containing the .tf module. */
  moduleDir: string;
  /** Input variables, passed as `-var k=v`. Merged with (overridden by) up()'s config. */
  vars?: Record<string, string>;
  /** IaC binary: 'tofu' (default) or 'terraform' — the CLIs are arg-compatible here. */
  bin?: string;
  /** Injectable for tests. */
  exec?: Exec;
  /** Name of the module output holding the TargetDescriptor JSON. Default 'target'. */
  outputName?: string;
}

/**
 * A single, generic Provisioner that delegates to a real IaC tool (OpenTofu /
 * Terraform) over a module directory, and maps the module's `target` output to
 * a {@link TargetDescriptor}. Provider quirks (VPC, roles, Fly org, …) live in
 * the module's HCL + its vars — never here. This is the whole "don't invent an
 * IaC DSL" decision made concrete: one provisioner, N modules.
 *
 * `exec` is injectable so the command construction + output parsing are
 * unit-tested without touching real cloud state.
 */
export class OpenTofuProvisioner implements Provisioner {
  readonly id = 'opentofu';
  private readonly moduleDir: string;
  private readonly vars: Record<string, string>;
  private readonly bin: string;
  private readonly exec: Exec;
  private readonly outputName: string;

  constructor(opts: OpenTofuProvisionerOptions) {
    if (!opts.moduleDir) throw new Error('OpenTofuProvisioner requires a moduleDir');
    this.moduleDir = opts.moduleDir;
    this.vars = opts.vars ?? {};
    this.bin = opts.bin ?? 'tofu';
    this.exec = opts.exec ?? shellExec;
    this.outputName = opts.outputName ?? 'target';
  }

  async up(config: Record<string, unknown> = {}): Promise<TargetDescriptor> {
    const vars = { ...this.vars, ...stringifyVars(config) };
    await run(this.exec, this.bin, this.args('init', []), { stream: true });
    await run(this.exec, this.bin, this.args('apply', ['-auto-approve', ...varArgs(vars)]), { stream: true });
    const { stdout } = await run(this.exec, this.bin, this.args('output', ['-json']));
    return parseTargetDescriptor(stdout, this.outputName);
  }

  async down(target: TargetDescriptor): Promise<void> {
    // Vars can be handed back through the descriptor so a fresh process can tear
    // down what another stood up; construction vars remain the base.
    const handed = (target.extra?.tofuVars as Record<string, string> | undefined) ?? {};
    const vars = { ...this.vars, ...handed };
    await run(this.exec, this.bin, this.args('destroy', ['-auto-approve', ...varArgs(vars)]), { stream: true });
  }

  /** `tofu -chdir=<dir> <cmd> -input=false -no-color [extra…]` */
  private args(cmd: string, extra: string[]): string[] {
    return [`-chdir=${this.moduleDir}`, cmd, '-input=false', '-no-color', ...extra];
  }
}

function varArgs(vars: Record<string, string>): string[] {
  return Object.entries(vars).flatMap(([k, v]) => ['-var', `${k}=${v}`]);
}

function stringifyVars(config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/** Parse `tofu output -json` and extract + validate the named TargetDescriptor. */
export function parseTargetDescriptor(outputJson: string, outputName = 'target'): TargetDescriptor {
  let all: Record<string, { value?: unknown }>;
  try {
    all = JSON.parse(outputJson);
  } catch {
    throw new Error(`could not parse '${outputName}' from tofu output -json`);
  }
  const entry = all[outputName];
  if (!entry || typeof entry !== 'object' || !('value' in entry)) {
    throw new Error(
      `OpenTofu module has no '${outputName}' output — add:\n  output "${outputName}" { value = { version = 1, runner = "<name>", … } }`,
    );
  }
  const v = entry.value as Partial<TargetDescriptor>;
  if (!v || typeof v !== 'object' || v.version !== 1 || typeof v.runner !== 'string' || !v.runner) {
    throw new Error(`'${outputName}' output must be a TargetDescriptor: { version = 1, runner = "<name>", … }`);
  }
  return v as TargetDescriptor;
}
