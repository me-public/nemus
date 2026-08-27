import { createSign } from 'node:crypto';
import { ForgeToken, ForgeTokenSource, TokenScope } from './types';

/**
 * GitHub App auth, contained entirely in this one class.
 *
 * It mints short-lived, LEAST-PRIVILEGE, auto-refreshing *installation* tokens
 * from the App's private key. Everything GitHub-specific about App auth lives
 * here; the rest of the system only sees a `ForgeTokenSource`.
 *
 * Dependency-free: the RS256 JWT is signed with Node's built-in `crypto`, so
 * this runs in the runner image without pulling a JWT library.
 *
 * Private-key placement (who runs this) is a deployment *policy*, not baked in:
 *   A. client-side  — the control plane mints and injects only the 1h token
 *                     into the task; the key never reaches the runner (default).
 *   B. in-task      — the runner holds the key (via the provider secret store)
 *                     and refreshes itself; for long, fire-and-forget runs.
 *   C. broker       — a small long-lived service holds the key and issues
 *                     scoped tokens on request.
 * The same class serves all three — only *where* it is instantiated differs.
 */

export interface GitHubAppConfig {
  /** Numeric App ID. */
  appId: string | number;
  /** PEM-encoded RSA private key. Read from a secret store; never logged. */
  privateKey: string;
  /** Installation ID. Optional — auto-discovered from `owner` if omitted. */
  installationId?: string | number;
  /** Repo owner (org/user login), used to auto-discover the installation. */
  owner?: string;
  /** API base, default `https://api.github.com` (set for GitHub Enterprise). */
  apiBaseUrl?: string;
  /** Refresh this many ms before expiry (default 5 min). */
  refreshSkewMs?: number;
  /** Injectable clock (ms), for tests. */
  now?: () => number;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mint a GitHub App JWT (RS256), valid ~9 minutes (< GitHub's 10-min hard cap),
 * back-dated 30s for clock skew. Dependency-free.
 */
export function mintAppJwt(
  appId: string | number,
  privateKey: string,
  nowMs: number = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000) - 30;
  const exp = iat + 9 * 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(privateKey));
  return `${signingInput}.${signature}`;
}

export class GitHubAppTokenSource implements ForgeTokenSource {
  readonly id = 'github-app';

  /** Cached tokens, keyed by scope, so distinct scopes don't evict each other. */
  private readonly cache = new Map<string, { token: string; expiresAtMs: number }>();
  /** In-flight mints, keyed by scope, to coalesce concurrent refreshes. */
  private readonly inflight = new Map<string, Promise<ForgeToken>>();
  private readonly api: string;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly skewMs: number;
  private installationId?: string | number;

  constructor(private readonly cfg: GitHubAppConfig) {
    if (!cfg.appId) throw new Error('github-app: appId is required');
    if (!cfg.privateKey) throw new Error('github-app: privateKey is required');
    this.api = (cfg.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.now = cfg.now ?? (() => Date.now());
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.skewMs = cfg.refreshSkewMs ?? 5 * 60 * 1000;
    this.installationId = cfg.installationId;
  }

  async getToken(scope?: TokenScope): Promise<ForgeToken> {
    const scopeKey = this.scopeKey(scope);

    const hit = this.cache.get(scopeKey);
    if (hit && hit.expiresAtMs - this.skewMs > this.now()) {
      return { token: hit.token, expiresAt: new Date(hit.expiresAtMs) };
    }

    // Coalesce concurrent refreshes for the same scope so parallel callers mint
    // one token, not N (the thundering-herd lesson from workspace-manager).
    const pending = this.inflight.get(scopeKey);
    if (pending) return pending;

    const promise = this.mint(scope, scopeKey).finally(() => {
      this.inflight.delete(scopeKey);
    });
    this.inflight.set(scopeKey, promise);
    return promise;
  }

  private async mint(scope: TokenScope | undefined, scopeKey: string): Promise<ForgeToken> {
    const jwt = mintAppJwt(this.cfg.appId, this.cfg.privateKey, this.now());
    const installationId = await this.resolveInstallationId(jwt);

    // Least privilege: narrow to specific repos + minimal permissions when asked.
    const body: Record<string, unknown> = {};
    if (scope?.repos?.length) {
      body.repositories = scope.repos.map((r) => (r.includes('/') ? r.split('/')[1] : r));
    }
    if (scope?.permissions) body.permissions = scope.permissions;

    const res = await this.fetchImpl(
      `${this.api}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: this.headers(jwt, true),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `github-app: minting installation token failed (${res.status}) ${detail}`.trim(),
      );
    }
    const json = (await res.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof json.token !== 'string' || !json.token) {
      throw new Error('github-app: response contained no token');
    }
    const expiresAtMs = new Date(String(json.expires_at)).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      throw new Error(`github-app: response had invalid expires_at "${String(json.expires_at)}"`);
    }
    this.cache.set(scopeKey, { token: json.token, expiresAtMs });
    return { token: json.token, expiresAt: new Date(expiresAtMs) };
  }

  /** Resolve the installation id: explicit config wins, else discover by owner. */
  private async resolveInstallationId(jwt: string): Promise<string | number> {
    if (this.installationId != null) return this.installationId;

    const res = await this.fetchImpl(`${this.api}/app/installations`, {
      headers: this.headers(jwt, false),
    });
    if (!res.ok) {
      throw new Error(`github-app: listing installations failed (${res.status})`);
    }
    const list = (await res.json()) as Array<{ id: number; account?: { login?: string } }>;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('github-app: this App has no installations');
    }

    const match = this.cfg.owner
      ? list.find(
          (i) => i.account?.login?.toLowerCase() === this.cfg.owner!.toLowerCase(),
        )
      : list.length === 1
        ? list[0]
        : undefined;

    if (!match) {
      throw new Error(
        this.cfg.owner
          ? `github-app: no installation found for owner "${this.cfg.owner}"`
          : 'github-app: multiple installations — set installationId or owner',
      );
    }
    this.installationId = match.id;
    return match.id;
  }

  private headers(jwt: string, json: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private scopeKey(scope?: TokenScope): string {
    return JSON.stringify({
      r: scope?.repos ? [...scope.repos].sort() : null,
      p: scope?.permissions ?? null,
    });
  }
}
