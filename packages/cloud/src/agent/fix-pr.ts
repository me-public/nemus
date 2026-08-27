import * as path from 'node:path';
import { ForgeTokenSource } from '../forge/types';
import { GitForge } from '../gitforge/types';
import { Notifier } from '../notify/types';
import { runCiLoop } from '../ci/loop';
import { parseRepo } from './env';
import { AgentInvoker, GitOps, RunResult } from './types';

/**
 * `fix-pr` entry mode: instead of opening a NEW PR, take an EXISTING PR and
 * drive it to green with the bounded CI-loop (P3) + optional notifications (P4).
 * This is what makes P3/P4 usable end-to-end inside the runner image — the
 * container clones the repo, checks out the PR head, and hands off to runCiLoop.
 *
 * Vendor-neutral throughout: talks only to GitForge / GitOps / AgentInvoker /
 * Notifier, so it works against GitHub or GitLab with no code change.
 */
export interface FixPrConfig {
  repo: { owner: string; name: string; full: string };
  /** PR/MR number (for the give-up comment + logging). */
  prNumber: number;
  /** Head branch the PR is built from — checks read here, fixes pushed here. */
  branch: string;
  agent: string;
  /** Original task text, threaded into the fix prompt for context (optional). */
  task?: string;
  gitHost: string;
  workdir: string;
  /** CI-loop tuning (all optional; runCiLoop supplies defaults). */
  maxIterations?: number;
  pollIntervalMs?: number;
  maxPollsPerIteration?: number;
}

export interface FixPrDeps {
  git: GitOps;
  agent: AgentInvoker;
  forge: GitForge;
  tokenSource: ForgeTokenSource;
  notifier?: Notifier;
  sleep: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}

/**
 * Parse the runner-image env contract for `fix-pr` mode. In addition to the
 * shared vars (NEMUS_AGENT/NEMUS_WORKDIR/GIT_HOST/NEMUS_OWNER):
 *   NEMUS_REPOS        (required) a single `owner/name` (or bare name + NEMUS_OWNER)
 *   NEMUS_PR_NUMBER    (required) the PR/MR number
 *   NEMUS_PR_BRANCH    (required) the PR head branch
 *   NEMUS_TASK         (optional) original task text, for fix-prompt context
 *   NEMUS_CI_MAX_ITERATIONS / NEMUS_CI_POLL_INTERVAL_MS / NEMUS_CI_MAX_POLLS
 */
export function parseFixPrEnv(env: NodeJS.ProcessEnv = process.env): FixPrConfig {
  const reposRaw = (env.NEMUS_REPOS ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (reposRaw.length === 0) throw new Error('NEMUS_REPOS is required (one owner/name for fix-pr)');
  if (reposRaw.length > 1) throw new Error('fix-pr operates on a single repo; NEMUS_REPOS has more than one');

  const owner = (env.NEMUS_OWNER || env.GITHUB_ORG || env.NEMUS_GIT_OWNER)?.trim() || undefined;
  const repo = parseRepo(reposRaw[0], owner);

  const branch = env.NEMUS_PR_BRANCH?.trim();
  if (!branch) throw new Error('NEMUS_PR_BRANCH is required (the PR head branch)');

  const prNumber = intFromEnv(env.NEMUS_PR_NUMBER, 'NEMUS_PR_NUMBER');
  if (prNumber === undefined) throw new Error('NEMUS_PR_NUMBER is required');

  return {
    repo,
    prNumber,
    branch,
    agent: env.NEMUS_AGENT?.trim() || 'pi',
    task: env.NEMUS_TASK?.trim() || undefined,
    gitHost: env.GIT_HOST?.trim() || 'github.com',
    workdir: env.NEMUS_WORKDIR?.trim() || '/workspace',
    maxIterations: intFromEnv(env.NEMUS_CI_MAX_ITERATIONS, 'NEMUS_CI_MAX_ITERATIONS'),
    pollIntervalMs: intFromEnv(env.NEMUS_CI_POLL_INTERVAL_MS, 'NEMUS_CI_POLL_INTERVAL_MS'),
    maxPollsPerIteration: intFromEnv(env.NEMUS_CI_MAX_POLLS, 'NEMUS_CI_MAX_POLLS'),
  };
}

/**
 * Run the fix-pr flow: clone the repo, check out the PR head, and drive the
 * bounded CI-loop. Returns a `RunResult` (schema 1) so result.json stays a
 * single, uniform contract across entry modes.
 */
export async function runFixPr(config: FixPrConfig, deps: FixPrDeps): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const result: RunResult = {
    schema: 1,
    ok: false,
    mode: 'fix-pr',
    agent: config.agent,
    task: config.task ?? `fix-pr ${config.repo.full}#${config.prNumber}`,
    startedAt,
    finishedAt: startedAt,
    repos: [{ repo: config.repo.full, cloned: false, branch: config.branch }],
  };
  const entry = result.repos[0];

  const repoDir = path.join(config.workdir, config.repo.name);

  // Least-privilege token for git + the give-up comment on exactly this repo.
  let token: string;
  try {
    const t = await deps.tokenSource.getToken({
      repos: [config.repo.full],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    token = t.token;
  } catch (e) {
    result.error = `forge auth failed: ${(e as Error).message}`;
    result.finishedAt = new Date().toISOString();
    return result;
  }

  // Clone + check out the PR head branch.
  try {
    const url = `https://x-access-token:${token}@${config.gitHost}/${config.repo.full}.git`;
    await deps.git.clone(url, repoDir);
    await deps.git.checkout(repoDir, config.branch);
    entry.cloned = true;
  } catch (e) {
    entry.error = (e as Error).message;
    result.error = `could not prepare PR checkout: ${(e as Error).message}`;
    result.finishedAt = new Date().toISOString();
    return result;
  }

  // Hand off to the bounded CI-loop (P3) with optional notifications (P4).
  const ci = await runCiLoop(
    {
      repo: { owner: config.repo.owner, repo: config.repo.name },
      prNumber: config.prNumber,
      branch: config.branch,
      workdir: repoDir,
      agent: config.agent,
      task: config.task,
      maxIterations: config.maxIterations,
      pollIntervalMs: config.pollIntervalMs,
      maxPollsPerIteration: config.maxPollsPerIteration,
    },
    {
      forge: deps.forge,
      git: deps.git,
      agent: deps.agent,
      notifier: deps.notifier,
      sleep: deps.sleep,
      log: deps.log,
    },
  );

  result.ci = { ok: ci.ok, state: ci.state, iterations: ci.iterations };
  result.ok = ci.ok;
  entry.changed = ci.iterations > 0;
  entry.pushed = ci.iterations > 0;
  entry.prNumber = config.prNumber;
  if (!ci.ok) entry.error = `ci-loop: ${ci.state}`;
  result.finishedAt = new Date().toISOString();
  return result;
}

function intFromEnv(raw: string | undefined, name: string): number | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}
