/**
 * GitForge — the code-host seam (open a PR, read checks, comment). `github` is
 * the default; `gitlab` etc. are additional implementations. Core report-back
 * and CI-loop talk only to this, never to a host's SDK.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface OpenPRInput extends RepoRef {
  /** Source branch (head). */
  head: string;
  /** Target branch (base), e.g. 'main'. */
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
}

export interface PullRequest {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft?: boolean;
}

export type CheckStatus = 'queued' | 'in_progress' | 'completed' | 'unknown';
export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped'
  | null;

export interface CheckRun {
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion;
}

export interface CommentInput extends RepoRef {
  /** PR/issue number. */
  number: number;
  body: string;
}

export interface GitForge {
  readonly id: string;
  openPR(input: OpenPRInput): Promise<PullRequest>;
  /** Checks for a commit SHA (or a branch name the host can resolve). */
  getChecks(ref: RepoRef & { ref: string }): Promise<CheckRun[]>;
  comment(input: CommentInput): Promise<void>;
}
