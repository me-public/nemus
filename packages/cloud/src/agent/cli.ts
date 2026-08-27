#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { forgeAuthFromEnv } from '../index';
import { createForge, forgeKindFromEnv, forgeApiBaseFromEnv } from '../gitforge/registry';
import { notifierFromEnv } from '../notify/index';
import { parseAgentEnv } from './env';
import { parseFixPrEnv, runFixPr } from './fix-pr';
import { runAgentTask, RunAgentDeps } from './run';
import { ShellGitOps } from './git-ops';
import { ShellAgentInvoker } from './agent-invoker';
import { RunResult } from './types';

/**
 * Container entrypoint (`nemus-cloud-agent`). Reads the env contract, runs the
 * task, writes result.json to the workspace, and exits non-zero on failure so
 * the runner's `status` reflects it. Designed to be the image's ENTRYPOINT.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let workdir = env.NEMUS_WORKDIR?.trim() || '/workspace';
  const mode = env.NEMUS_MODE?.trim() || 'agent';
  let result: RunResult;
  try {
    const tokenSource = forgeAuthFromEnv(env);
    const forgeKind = forgeKindFromEnv(env);
    const forge = createForge(forgeKind, {
      tokenSource,
      apiBaseUrl: forgeApiBaseFromEnv(forgeKind, env),
    });
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    if (mode === 'fix-pr') {
      // Drive an EXISTING PR to green (CI-loop + notifications), no new PR.
      const cfg = parseFixPrEnv(env);
      workdir = cfg.workdir;
      result = await runFixPr(cfg, {
        git: new ShellGitOps(),
        agent: new ShellAgentInvoker({ env }),
        forge,
        tokenSource,
        notifier: notifierFromEnv(env),
        sleep,
        log: (s) => process.stdout.write(`[nemus-cloud-agent] ${s}\n`),
      });
    } else {
      const config = parseAgentEnv(env);
      workdir = config.workdir;
      const deps: RunAgentDeps = {
        git: new ShellGitOps(),
        agent: new ShellAgentInvoker({ env }),
        forge,
        tokenSource,
      };
      result = await runAgentTask(config, deps);
    }
  } catch (e) {
    const now = new Date().toISOString();
    result = {
      schema: 1,
      ok: false,
      mode: mode === 'fix-pr' ? 'fix-pr' : 'agent',
      agent: env.NEMUS_AGENT?.trim() || 'pi',
      task: env.NEMUS_TASK ?? '',
      startedAt: now,
      finishedAt: now,
      repos: [],
      error: (e as Error).message,
    };
  }

  writeResult(workdir, result);
  process.stdout.write(`\n[nemus-cloud-agent] result: ${result.ok ? 'ok' : 'failed'}\n`);
  for (const r of result.repos) {
    const status = r.error ? `error: ${r.error}` : r.prUrl ? `PR ${r.prUrl}` : r.changed === false ? 'no changes' : r.pushed ? 'pushed' : 'cloned';
    process.stdout.write(`  ${r.repo}: ${status}\n`);
  }
  if (result.error) process.stderr.write(`[nemus-cloud-agent] ${result.error}\n`);
  return result.ok ? 0 : 1;
}

function writeResult(workdir: string, result: RunResult): void {
  try {
    writeFileSync(path.join(workdir, 'result.json'), JSON.stringify(result, null, 2));
  } catch {
    // Fall back to cwd if the workspace isn't writable; never crash on reporting.
    try {
      writeFileSync('result.json', JSON.stringify(result, null, 2));
    } catch {
      /* best-effort */
    }
  }
}

// Executed directly as the container entrypoint.
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`[nemus-cloud-agent] fatal: ${e}\n`);
      process.exit(1);
    });
}
