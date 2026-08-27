import * as path from 'node:path';
import { ForgeTokenSource } from '../forge/types';
import { GitForge } from '../gitforge/types';
import { parseRepo } from './env';
import { AgentInvoker, AgentRunConfig, GitOps, RepoResult, RunResult } from './types';

export interface RunAgentDeps {
  git: GitOps;
  agent: AgentInvoker;
  forge: GitForge;
  tokenSource: ForgeTokenSource;
}

/**
 * Orchestrate one agent task inside the container. Clones every repo into one
 * workspace, runs the agent ONCE over all of them, then opens a PR per changed
 * repo. Per-repo failures are isolated; the run reports partial success rather
 * than aborting everything.
 */
export async function runAgentTask(
  config: AgentRunConfig,
  deps: RunAgentDeps,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const result: RunResult = {
    schema: 1,
    ok: false,
    agent: config.agent,
    task: config.task,
    startedAt,
    finishedAt: startedAt,
    repos: [],
  };

  const branch = `${config.branchPrefix}${slug(config.task)}`;
  // Least-privilege token for git + PRs across exactly these repos.
  const { token } = await deps.tokenSource.getToken({
    repos: config.repos,
    permissions: { contents: 'write', pull_requests: 'write' },
  });

  // 1. Clone + branch each repo. A clone failure is isolated to that repo.
  const cloned: Array<{ owner: string; name: string; full: string; dir: string }> = [];
  for (const ref of config.repos) {
    let parsed: ReturnType<typeof parseRepo>;
    try {
      parsed = parseRepo(ref, config.owner);
    } catch (e) {
      result.repos.push({ repo: ref, cloned: false, error: (e as Error).message });
      continue;
    }
    const dir = path.join(config.workdir, parsed.name);
    const url = `https://x-access-token:${token}@${config.gitHost}/${parsed.full}.git`;
    try {
      await deps.git.clone(url, dir);
      await deps.git.checkoutNewBranch(dir, branch);
      cloned.push({ ...parsed, dir });
      result.repos.push({ repo: parsed.full, cloned: true, branch });
    } catch (e) {
      result.repos.push({ repo: parsed.full, cloned: false, error: (e as Error).message });
    }
  }

  if (cloned.length === 0) {
    result.error = 'no repositories were cloned';
    result.finishedAt = new Date().toISOString();
    return result;
  }

  // 2. Run the agent ONCE over the whole workspace (it may touch any repo).
  try {
    await deps.agent.run({ workdir: config.workdir, task: config.task, agent: config.agent });
  } catch (e) {
    result.error = `agent run failed: ${(e as Error).message}`;
    result.finishedAt = new Date().toISOString();
    return result;
  }

  // 3. Per changed repo: commit, push, open a PR.
  for (const repo of cloned) {
    const entry = result.repos.find((r) => r.repo === repo.full)!;
    try {
      if (!(await deps.git.hasChanges(repo.dir))) {
        entry.changed = false;
        continue;
      }
      entry.changed = true;
      await deps.git.commitAll(repo.dir, commitMessage(config.task));
      await deps.git.push(repo.dir, branch);
      entry.pushed = true;

      if (config.report === 'pr') {
        const pr = await deps.forge.openPR({
          owner: repo.owner,
          repo: repo.name,
          head: branch,
          base: config.baseBranch,
          title: prTitle(config.task),
          body: prBody(config.task, config.agent),
          draft: config.draft,
        });
        entry.prUrl = pr.url;
        entry.prNumber = pr.number;
      }
    } catch (e) {
      entry.error = (e as Error).message;
    }
  }

  // ok = every cloned repo finished without a per-repo error.
  result.ok = result.repos.every((r) => !r.error);
  result.finishedAt = new Date().toISOString();
  return result;
}

/** Branch-safe slug of the task (short, lowercase, hyphenated). */
export function slug(task: string): string {
  return (
    task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'task'
  );
}

function commitMessage(task: string): string {
  return `${firstLine(task)}\n\nvia nemus cloud agent`;
}
function prTitle(task: string): string {
  return firstLine(task).slice(0, 72);
}
function prBody(task: string, agent: string): string {
  return `Automated by the Nemus cloud agent (\`${agent}\`).\n\n**Task**\n\n> ${task.replace(/\n/g, '\n> ')}`;
}
function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim()) ?? s).trim();
}
