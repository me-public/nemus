import { Exec, run, shellExec } from './exec';
import { AgentInvoker } from './types';

export interface ShellAgentInvokerOptions {
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs a coding-agent CLI headlessly over the workspace. Presets for `pi`
 * (default) and `claude`; both run non-interactively with the task as the
 * prompt and the workspace as cwd, streaming output through for logs.
 *
 * NOTE: the exact flags target the real CLIs and are the one thing to validate
 * in a live image build; they're isolated here (and overridable via
 * NEMUS_AGENT_ARGS) so tuning them never touches the orchestrator. The
 * two-phase plan/execute flow (ported from workspace-manager) is a documented
 * follow-up on top of this single-pass baseline.
 */
export class ShellAgentInvoker implements AgentInvoker {
  private readonly exec: Exec;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: ShellAgentInvokerOptions = {}) {
    this.exec = opts.exec ?? shellExec;
    this.env = opts.env ?? process.env;
  }

  async run(input: { workdir: string; task: string; agent: string }): Promise<void> {
    const { bin, args } = buildAgentCommand(input.agent, input.task, this.env);
    await run(this.exec, bin, args, { cwd: input.workdir, env: this.env, stream: true });
  }
}

/** Build the `{bin, args}` for a given agent. Kept pure + exported for tests. */
export function buildAgentCommand(
  agent: string,
  task: string,
  env: NodeJS.ProcessEnv = process.env,
): { bin: string; args: string[] } {
  // Escape hatch: NEMUS_AGENT_ARGS is a space-split arg list; {task} is replaced.
  const override = env.NEMUS_AGENT_ARGS;
  if (override) {
    const args = override.split(' ').filter(Boolean).map((a) => (a === '{task}' ? task : a));
    return { bin: agent, args };
  }
  switch (agent) {
    case 'claude':
      return { bin: 'claude', args: ['-p', task, '--dangerously-skip-permissions'] };
    case 'pi':
    default:
      // pi runs tools headlessly in -p mode (no approval prompts).
      return { bin: 'pi', args: ['-p', task] };
  }
}
