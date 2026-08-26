/**
 * The single auth seam the rest of the cloud system depends on.
 *
 * Nothing downstream (git credential helper, GitForge, CI-loop) knows whether a
 * token came from a static PAT, a GitHub App installation, a GitLab token, or an
 * OAuth flow — they only ever call `getToken()`. That containment is what keeps
 * the design generic: swapping `pat` <-> `github-app` <-> `gitlab-token` in
 * config changes nothing but the source.
 */

export interface ForgeToken {
  /** The bearer/basic token to use for git + API calls. */
  token: string;
  /** When this token stops being valid. Static PATs report a far-future date. */
  expiresAt: Date;
}

export interface TokenScope {
  /**
   * Repositories the token should be limited to. Accepts either bare names
   * (`"api"`) or `owner/name` (`"acme/api"`); sources that support least-
   * privilege scoping (e.g. GitHub App) will narrow the token to just these.
   */
  repos?: string[];
  /**
   * Minimal permissions to request, e.g. `{ contents: "write",
   * pull_requests: "write", checks: "read" }`. Sources that cannot scope
   * permissions ignore this.
   */
  permissions?: Record<string, string>;
}

/**
 * A source of short-lived forge tokens. Implementations are responsible for
 * their own caching and refresh; callers may invoke `getToken()` freely and
 * assume they get a token valid "now".
 */
export interface ForgeTokenSource {
  /** Stable identifier, e.g. 'pat' | 'github-app' | 'gitlab-token'. */
  readonly id: string;
  getToken(scope?: TokenScope): Promise<ForgeToken>;
}
