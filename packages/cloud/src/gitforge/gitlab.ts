import { ForgeTokenSource } from '../forge/types';
import {
  CheckRun,
  CommentInput,
  GitForge,
  OpenPRInput,
  PullRequest,
  RepoRef,
} from './types';

export interface GitLabForgeOptions {
  tokenSource: ForgeTokenSource;
  /** API base, default `https://gitlab.com/api/v4` (set for self-managed GitLab). */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * GitForge over the GitLab REST API v4, authenticated by a `ForgeTokenSource`
 * (a personal/project/group access token, or an OAuth token — sent as a Bearer,
 * which modern GitLab accepts for all of them). Dependency-free: uses `fetch`.
 *
 * Mapping to the neutral GitForge vocabulary:
 * - A GitHub "pull request" is a GitLab **merge request**; `PullRequest.number`
 *   is the MR **iid** (project-scoped), which is what note/comment calls use.
 * - "checks" are GitLab **commit statuses** (the union of pipeline jobs and
 *   external statuses) for the head SHA.
 * - a repo `{ owner, repo }` addresses a GitLab project by its URL-encoded
 *   `namespace/path` (subgroups in `owner` are fine — the slash is encoded).
 * - draft is expressed by the `Draft:` title prefix, GitLab's own convention.
 */
export class GitLabForge implements GitForge {
  readonly id = 'gitlab';
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitLabForgeOptions) {
    this.api = (opts.apiBaseUrl ?? 'https://gitlab.com/api/v4').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async openPR(input: OpenPRInput): Promise<PullRequest> {
    // GitLab marks a draft MR by a `Draft:` title prefix; don't double-prefix.
    const title =
      input.draft && !/^\s*draft:\s*/i.test(input.title) ? `Draft: ${input.title}` : input.title;
    const json = await this.request<any>('POST', `/projects/${this.projectId(input)}/merge_requests`, {
      source_branch: input.head,
      target_branch: input.base,
      title,
      description: input.body ?? '',
    });
    return this.toPullRequest(json);
  }

  async getChecks(ref: RepoRef & { ref: string }): Promise<CheckRun[]> {
    // Commit statuses = pipeline jobs + external statuses for the SHA.
    const json = await this.request<any[]>(
      'GET',
      `/projects/${this.projectId(ref)}/repository/commits/${encodeURIComponent(ref.ref)}/statuses?per_page=100`,
    );
    return (json ?? []).map((s: any) => mapStatus(s.name ?? s.id ?? 'status', s.status));
  }

  async comment(input: CommentInput): Promise<void> {
    await this.request(
      'POST',
      `/projects/${this.projectId(input)}/merge_requests/${input.number}/notes`,
      { body: input.body },
    );
  }

  /** URL-encoded `namespace/path` project identifier (subgroup slashes encoded). */
  private projectId(ref: RepoRef): string {
    return encodeURIComponent(`${ref.owner}/${ref.repo}`);
  }

  private toPullRequest(json: any): PullRequest {
    const state: PullRequest['state'] =
      json.state === 'merged' ? 'merged' : json.state === 'opened' ? 'open' : 'closed';
    return {
      number: json.iid,
      url: json.web_url,
      state,
      draft: json.draft ?? json.work_in_progress ?? false,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { token } = await this.opts.tokenSource.getToken();
    const res = await this.fetchImpl(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`gitlab ${method} ${path} failed (${res.status}) ${detail}`.trim());
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
}

/**
 * Map a GitLab commit-status state to the neutral CheckRun shape. Kept exported-
 * free but pure so the mapping is unit-tested via getChecks. A `manual` job is a
 * deliberate optional gate, so it's `neutral` (not a failure) — the CI loop must
 * not treat an un-triggered manual job as a red check.
 */
function mapStatus(name: string, status: string): CheckRun {
  switch (status) {
    case 'success':
      return { name, status: 'completed', conclusion: 'success' };
    case 'failed':
      return { name, status: 'completed', conclusion: 'failure' };
    case 'canceled':
    case 'cancelled':
      return { name, status: 'completed', conclusion: 'cancelled' };
    case 'skipped':
      return { name, status: 'completed', conclusion: 'skipped' };
    case 'manual':
      return { name, status: 'completed', conclusion: 'neutral' };
    case 'running':
      return { name, status: 'in_progress', conclusion: null };
    case 'created':
    case 'pending':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
      return { name, status: 'queued', conclusion: null };
    default:
      return { name, status: 'unknown', conclusion: null };
  }
}
