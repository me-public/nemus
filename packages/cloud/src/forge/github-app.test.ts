import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mintAppJwt, GitHubAppTokenSource } from './github-app';
import { PatTokenSource } from './pat';
import { createForgeTokenSource, forgeAuthFromEnv } from '../index';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decodeJwt(jwt: string) {
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return { header, payload, h, p, s };
}

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/**
 * A fetch stub that routes by URL (not call order), since the source caches the
 * installation id after first discovery and won't re-list installations.
 *  - `installations`: response for GET /app/installations
 *  - `token(n)`: response for the n-th POST .../access_tokens (1-based)
 */
function routeFetch(routes: {
  installations?: () => any;
  token: (n: number) => any;
}) {
  const calls: Array<{ url: string; init?: any }> = [];
  let tokenCalls = 0;
  const fetchImpl = (async (url: string, init?: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith('/app/installations')) {
      if (!routes.installations) throw new Error('unexpected installations call');
      return routes.installations();
    }
    if (u.includes('/access_tokens')) return routes.token(++tokenCalls);
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('mintAppJwt', () => {
  it('produces a verifiable RS256 JWT with the right claims', () => {
    const now = 1_700_000_000_000;
    const jwt = mintAppJwt(12345, PEM, now);
    const { header, payload, h, p, s } = decodeJwt(jwt);

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload.iss).toBe('12345');
    // back-dated 30s, expires < 10min after iat
    expect(payload.iat).toBe(Math.floor(now / 1000) - 30);
    expect(payload.exp - payload.iat).toBeLessThan(600);

    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    const sig = Buffer.from(s, 'base64url');
    expect(v.verify(publicKey, sig)).toBe(true);
  });
});

describe('GitHubAppTokenSource', () => {
  const base = { appId: 42, privateKey: PEM, owner: 'acme' };

  it('auto-discovers the installation by owner and mints a scoped token', async () => {
    const { fetchImpl, calls } = routeFetch({
      installations: () =>
        ok([{ id: 111, account: { login: 'other' } }, { id: 222, account: { login: 'acme' } }]),
      token: () => ok({ token: 'ghs_installtoken', expires_at: '2030-01-01T01:00:00Z' }),
    });

    const src = new GitHubAppTokenSource({ ...base, fetchImpl, now: () => 1_700_000_000_000 });
    const t = await src.getToken({
      repos: ['acme/api', 'web'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });

    expect(t.token).toBe('ghs_installtoken');
    // discovered installation 222 (owner "acme"), not 111
    expect(calls[1].url).toContain('/app/installations/222/access_tokens');
    // least privilege: bare repo names + permissions in the body
    const body = JSON.parse(calls[1].init.body);
    expect(body.repositories).toEqual(['api', 'web']);
    expect(body.permissions).toEqual({ contents: 'write', pull_requests: 'write' });
  });

  it('caches within TTL and refreshes after expiry', async () => {
    let clock = 1_700_000_000_000;
    const { fetchImpl, calls } = routeFetch({
      installations: () => ok([{ id: 222, account: { login: 'acme' } }]),
      token: (n) =>
        ok({
          token: `tok-${n}`,
          expires_at: new Date(clock + n * 60 * 60 * 1000).toISOString(),
        }),
    });
    const src = new GitHubAppTokenSource({ ...base, fetchImpl, now: () => clock });

    const a = await src.getToken();
    const b = await src.getToken(); // cached — no new fetches
    expect(a.token).toBe('tok-1');
    expect(b.token).toBe('tok-1');
    const callsAfterCache = calls.length;

    clock += 61 * 60 * 1000; // past first token's expiry (+ skew)
    const c = await src.getToken();
    expect(c.token).toBe('tok-2');
    expect(calls.length).toBeGreaterThan(callsAfterCache);
  });

  it('treats a different scope as a separate cache entry', async () => {
    const { fetchImpl, calls } = routeFetch({
      installations: () => ok([{ id: 222, account: { login: 'acme' } }]),
      token: (n) => ok({ token: `tok-${n}`, expires_at: '2030-01-01T00:00:00Z' }),
    });
    const src = new GitHubAppTokenSource({ ...base, fetchImpl });
    await src.getToken({ repos: ['api'] });
    const n = calls.length;
    await src.getToken({ repos: ['web'] }); // different scope -> refetch
    expect(calls.length).toBeGreaterThan(n);
  });

  it('coalesces concurrent refreshes into a single mint', async () => {
    let tokenPosts = 0;
    const { fetchImpl } = routeFetch({
      installations: () => ok([{ id: 222, account: { login: 'acme' } }]),
      token: () => {
        tokenPosts++;
        return ok({ token: 'tok', expires_at: '2030-01-01T00:00:00Z' });
      },
    });
    const src = new GitHubAppTokenSource({ ...base, fetchImpl });
    // Fire many in parallel on a cold cache.
    const results = await Promise.all(Array.from({ length: 5 }, () => src.getToken()));
    expect(results.every((r) => r.token === 'tok')).toBe(true);
    expect(tokenPosts).toBe(1); // one mint, not five
  });

  it('rejects a malformed mint response instead of caching garbage', async () => {
    const { fetchImpl } = routeFetch({
      installations: () => ok([{ id: 222, account: { login: 'acme' } }]),
      token: () => ok({ token: 'tok', expires_at: 'not-a-date' }),
    });
    const src = new GitHubAppTokenSource({ ...base, fetchImpl });
    await expect(src.getToken()).rejects.toThrow(/invalid expires_at/);
  });

  it('surfaces a helpful error when the owner has no installation', async () => {
    const { fetchImpl } = routeFetch({
      installations: () => ok([{ id: 1, account: { login: 'someone-else' } }]),
      token: () => ok({ token: 'unused', expires_at: '2030-01-01T00:00:00Z' }),
    });
    const src = new GitHubAppTokenSource({ ...base, fetchImpl });
    await expect(src.getToken()).rejects.toThrow(/no installation found for owner "acme"/);
  });
});

describe('PatTokenSource', () => {
  it('returns the static token with a far-future expiry', async () => {
    const src = new PatTokenSource('ghp_static');
    const t = await src.getToken();
    expect(t.token).toBe('ghp_static');
    expect(t.expiresAt.getFullYear()).toBeGreaterThan(9000);
  });

  it('rejects an empty token', () => {
    expect(() => new PatTokenSource('')).toThrow();
  });
});

describe('factory + env resolution', () => {
  it('createForgeTokenSource picks the source by config', () => {
    expect(createForgeTokenSource({ token: 'x' }).id).toBe('pat');
    expect(createForgeTokenSource({ app: { appId: 1, privateKey: PEM } }).id).toBe('github-app');
    expect(() => createForgeTokenSource({ forge: 'nope' as any })).toThrow(/unknown forge/);
  });

  it('forgeAuthFromEnv prefers App creds, falls back to PAT', () => {
    expect(forgeAuthFromEnv({ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: PEM } as any).id).toBe(
      'github-app',
    );
    expect(forgeAuthFromEnv({ GITHUB_TOKEN: 'ghp_x' } as any).id).toBe('pat');
    expect(() => forgeAuthFromEnv({} as any)).toThrow(/no forge auth/);
  });
});
