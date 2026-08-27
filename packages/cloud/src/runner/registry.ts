import { Runner } from './types';
import { DockerRunner, DockerRunnerOptions } from './docker';

/**
 * A runner factory. Third-party backends ship as `@nemus-cli/cloud-<name>` and
 * register a factory here (or callers pass one in), resolved by name from
 * config — the same shape as the agents' `AGENT_ORDER`. Only `docker` ships
 * in-box; everything else is opt-in.
 */
export type RunnerFactory = (opts?: Record<string, unknown>) => Runner;

const registry = new Map<string, RunnerFactory>();

/** Register (or override) a runner factory by name. */
export function registerRunner(name: string, factory: RunnerFactory): void {
  registry.set(name, factory);
}

/** List the names of all registered runners. */
export function runnerNames(): string[] {
  return [...registry.keys()].sort();
}

/** Resolve a runner by name. Throws with the available names if unknown. */
export function createRunner(name: string, opts?: Record<string, unknown>): Runner {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `unknown runner "${name}" (registered: ${runnerNames().join(', ') || 'none'})`,
    );
  }
  return factory(opts);
}

// Ship the local Docker runner in-box.
registerRunner('docker', (opts) => new DockerRunner(opts as DockerRunnerOptions));
