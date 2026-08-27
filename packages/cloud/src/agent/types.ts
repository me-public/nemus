/**
 * The in-image agent orchestrator: what runs INSIDE the task container.
 *
 * Flow (see runAgentTask): clone every repo into one workspace dir → make a
 * branch in each → run the coding agent ONCE over the whole workspace (Nemus's
 * whole point: the agent sees every repo) → for each repo that changed, commit,
 * push, open a PR → write result.json → exit.
 *
 * The git/agent boundaries are injected so the flow is fully unit-testable
 * without a real container, git, or network.
 */

/** Parsed from the runner-image env contract (see parseAgentEnv). */
export interface AgentRunConfig {
  /** Repos to work on, as `owner/name` (owner filled from `owner` when bare). */
  repos: string[];
  /** The task/prompt for the agent. */
  task: string;
  /** Coding agent to run: 'pi' (default) | 'claude' | … */
  agent: string;
  /** Git host, default 'github.com'. */
  gitHost: string;
  /** Default owner for bare repo names (org/user). */
  owner?: string;
  /** Base branch to target with PRs, default 'main'. */
  baseBranch: string;
  /** Prefix for the work branch, default 'nemus/'. */
  branchPrefix: string;
  /** Workspace dir inside the container, default '/workspace'. */
  workdir: string;
  /** Whether to open PRs ('pr') or just push ('none'), default 'pr'. */
  report: 'none' | 'pr';
  /** Open PRs as drafts, default true. */
  draft: boolean;
}

export interface RepoResult {
  /** `owner/name`. */
  repo: string;
  cloned: boolean;
  branch?: string;
  changed?: boolean;
  pushed?: boolean;
  prUrl?: string;
  prNumber?: number;
  /** Per-repo failure (isolated; other repos still proceed). */
  error?: string;
}

/**
 * The report-back contract written to result.json and read by the caller /
 * report-back. Versioned because external tooling parses it.
 */
export interface RunResult {
  schema: 1;
  ok: boolean;
  agent: string;
  task: string;
  startedAt: string; // ISO 8601
  finishedAt: string;
  repos: RepoResult[];
  /** Top-level failure (env/agent), distinct from per-repo errors. */
  error?: string;
  /** Which entry mode produced this result (default 'agent'). Additive/optional. */
  mode?: 'agent' | 'fix-pr';
  /** Present for `fix-pr` runs: the bounded CI-loop outcome. */
  ci?: CiSummary;
}

/** Compact CI-loop outcome recorded in result.json for a `fix-pr` run. */
export interface CiSummary {
  ok: boolean;
  /** green | no_checks | exhausted | stuck | timeout */
  state: string;
  iterations: number;
}

/** Git operations, injected so the flow is testable. Implementations shell git. */
export interface GitOps {
  /** Clone `url` into `dir`. */
  clone(url: string, dir: string): Promise<void>;
  /** Create + switch to `branch` in the repo at `dir`. */
  checkoutNewBranch(dir: string, branch: string): Promise<void>;
  /** Switch to an existing `branch` (e.g. a PR head) in the repo at `dir`. */
  checkout(dir: string, branch: string): Promise<void>;
  /** True if the working tree has changes to commit. */
  hasChanges(dir: string): Promise<boolean>;
  /** Stage everything and commit with `message`. */
  commitAll(dir: string, message: string): Promise<void>;
  /** Push `branch` to origin. */
  push(dir: string, branch: string): Promise<void>;
}

/** Runs the coding agent once over the whole workspace. */
export interface AgentInvoker {
  run(input: { workdir: string; task: string; agent: string }): Promise<void>;
}
