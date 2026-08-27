import { ForgeTokenSource } from '../forge/types';
import {
  CheckRun,
  CommentInput,
  GitForge,
  OpenPRInput,
  PullRequest,
  RepoRef,
} from './types';

export interface GitHubForgeOptions {
  tokenSource: ForgeTokenSource;
  /** API base, default `https://api.github.com` (set for GitHub Enterprise). */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * GitForge over the GitHub REST API, authenticated by a `ForgeTokenSource`
 * (PAT or App installation token — this class doesn't care which). Dependency-
 * free: uses `fetch`. Works inside the runner image, where `gh` may be
 * unconfigured but a token is available.
 */
export class GitHubForge implements GitForge {
  readonly id = 'github';
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitHubForgeOptions) {
    this.api = (opts.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async openPR(input: OpenPRInput): Promise<PullRequest> {
    const json = await this.request<any>('POST', `/repos/${input.owner}/${input.repo}/pulls`, {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? '',
      draft: input.draft ?? false,
    });
    return {
      number: json.number,
      url: json.html_url,
      state: json.merged_at ? 'merged' : (json.state as 'open' | 'closed'),
      draft: json.draft,
    };
  }

  async getChecks(ref: RepoRef & { ref: string }): Promise<CheckRun[]> {
    // per_page=100 covers virtually every commit; full pagination is a follow-up.
    const json = await this.request<any>(
      'GET',
      `/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(ref.ref)}/check-runs?per_page=100`,
    );
    return (json.check_runs ?? []).map((c: any) => ({
      name: c.name,
      status: (c.status as CheckRun['status']) ?? 'unknown',
      conclusion: (c.conclusion as CheckRun['conclusion']) ?? null,
    }));
  }

  async comment(input: CommentInput): Promise<void> {
    await this.request(
      'POST',
      `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`,
      { body: input.body },
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { token } = await this.opts.tokenSource.getToken();
    const res = await this.fetchImpl(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`github ${method} ${path} failed (${res.status}) ${detail}`.trim());
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
}
