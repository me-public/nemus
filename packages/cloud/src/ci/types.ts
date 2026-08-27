import { RepoRef, GitForge } from '../gitforge/types';
import { AgentInvoker, GitOps } from '../agent/types';

/** Inputs to one CI-loop run (one PR on one repo). */
export interface CiLoopConfig {
  repo: RepoRef;
  /** PR number — for logging / an optional "needs a human" comment. */
  prNumber?: number;
  /** Head branch the PR is built from; checks are read by this ref, fixes pushed to it. */
  branch: string;
  /** Working checkout the fix agent + git operate in. */
  workdir: string;
  /** Coding agent id (pi | claude | …). */
  agent: string;
  /** The original task, threaded into the fix prompt for context. */
  task?: string;
  /** Max fix attempts before giving up (default 3). */
  maxIterations?: number;
  /** Delay between polls while checks are pending (default 15_000ms). */
  pollIntervalMs?: number;
  /** Max pending-polls per iteration before declaring a timeout (default 40). */
  maxPollsPerIteration?: number;
}

export type CiLoopState =
  | 'green' // checks passed
  | 'exhausted' // still failing after maxIterations fixes
  | 'stuck' // a fix produced no changes → agent can't progress
  | 'timeout'; // checks never completed within the poll budget

export interface CiLoopResult {
  ok: boolean;
  state: CiLoopState;
  /** How many fix attempts were made. */
  iterations: number;
  /** Checks as last seen. */
  checks: import('../gitforge/types').CheckRun[];
}

export interface CiLoopDeps {
  forge: GitForge;
  git: GitOps;
  agent: AgentInvoker;
  sleep: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}
