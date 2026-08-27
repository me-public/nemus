import { CheckRun } from '../gitforge/types';
import { buildFixPrompt, buildGiveUpComment, summarizeChecks } from './checks';
import { CiLoopConfig, CiLoopDeps, CiLoopResult, CiLoopState } from './types';

/**
 * Drive one PR to green: poll its checks, and when CI fails, run a fix pass,
 * commit, push, and re-check — bounded so it can never spin ("Ralph loop").
 * Vendor-neutral: talks only to GitForge / AgentInvoker / GitOps, so it runs
 * against GitHub today and any future forge/runner unchanged.
 *
 * Anti-runaway guards:
 *  - maxIterations caps fix attempts.
 *  - a fix that changes nothing → `stuck` (the agent can't make progress, so
 *    re-running it would just repeat — the per-commit loop-breaker).
 *  - a poll budget per iteration → `timeout` if checks never complete (also
 *    covers "this ref has no CI", which reads as perpetually pending).
 */
export async function runCiLoop(config: CiLoopConfig, deps: CiLoopDeps): Promise<CiLoopResult> {
  const { forge, git, agent, sleep, log } = deps;
  const maxIterations = config.maxIterations ?? 3;
  const pollIntervalMs = config.pollIntervalMs ?? 15_000;
  const maxPolls = config.maxPollsPerIteration ?? 40;
  const ref = config.branch; // read checks by branch head → always the latest push

  let iterations = 0;
  let sawChecks = false; // distinguish "no CI on this ref" from "CI hung"

  // Terminal exit: on a non-green give-up, tell the human on the PR (best-effort;
  // a failed comment must never change the loop's verdict).
  const finish = async (state: CiLoopState, ok: boolean, checks: CheckRun[]): Promise<CiLoopResult> => {
    if (!ok && config.prNumber !== undefined) {
      try {
        await forge.comment({
          owner: config.repo.owner,
          repo: config.repo.repo,
          number: config.prNumber,
          body: buildGiveUpComment(state, iterations, summarizeChecks(checks).failed),
        });
      } catch {
        /* best-effort */
      }
    }
    // Out-of-band report-back (Slack/webhook), best-effort. Only the outcomes a
    // human cares about: green (done) and give-ups (needs attention).
    if (deps.notifier && state !== 'no_checks') {
      const repoName = `${config.repo.owner}/${config.repo.repo}`;
      try {
        await deps.notifier.notify(
          ok
            ? { event: 'ci_green', title: `CI green: ${repoName}`, repo: repoName }
            : {
                event: 'needs_human',
                title: `CI-loop gave up (${state}): ${repoName}`,
                body: summarizeChecks(checks).failed.map((f) => `- ${f.name}`).join('\n') || undefined,
                repo: repoName,
              },
        );
      } catch {
        /* best-effort */
      }
    }
    return { ok, state, iterations, checks };
  };

  for (;;) {
    // 1) Wait for the head commit's checks to settle (or fail fast).
    let checks: CheckRun[] = [];
    let polls = 0;
    for (;;) {
      checks = await forge.getChecks({ owner: config.repo.owner, repo: config.repo.repo, ref });
      if (checks.length > 0) sawChecks = true;
      const summary = summarizeChecks(checks);
      if (!summary.pending) {
        if (summary.green) {
          log?.(`CI green after ${iterations} fix attempt(s)`);
          return finish('green', true, checks);
        }
        // 2) CI failed. Out of budget?
        if (iterations >= maxIterations) {
          log?.(`CI still failing after ${maxIterations} attempts — needs a human`);
          return finish('exhausted', false, checks);
        }
        // 3) Run a fix pass.
        log?.(
          `CI failing (${summary.failed.map((f) => f.name).join(', ')}); fix ${iterations + 1}/${maxIterations}`,
        );
        await agent.run({ workdir: config.workdir, task: buildFixPrompt(config, summary.failed), agent: config.agent });
        if (!(await git.hasChanges(config.workdir))) {
          log?.('fix pass produced no changes — stuck');
          return finish('stuck', false, checks);
        }
        await git.commitAll(
          config.workdir,
          `fix: address failing CI\n\n${summary.failed.map((f) => `- ${f.name}`).join('\n')}`,
        );
        await git.push(config.workdir, config.branch);
        iterations++;
        break; // re-enter the poll loop for the new head commit
      }
      if (++polls > maxPolls) {
        // Never saw a single check across the whole budget → this ref has no CI;
        // that's nothing to fix, not a failure (don't cry "needs a human").
        if (!sawChecks) {
          log?.('no CI checks on this ref — nothing to gate on');
          return finish('no_checks', true, checks);
        }
        log?.('checks did not complete within the poll budget — timeout');
        return finish('timeout', false, checks);
      }
      await sleep(pollIntervalMs);
    }
  }
}
