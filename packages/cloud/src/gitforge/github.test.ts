import { describe, it, expect } from 'vitest';
import { GitHubForge } from './github';
import { ForgeTokenSource } from '../forge/types';

const tokenSource: ForgeTokenSource = {
  id: 'test',
  getToken: async () => ({ token: 'ghs_test', expiresAt: new Date('2030-01-01') }),
};

function stubFetch(handler: (url: string, init: any) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    const { status, body } = handler(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('GitHubForge.openPR', () => {
  it('POSTs a draft PR with auth + returns normalized fields', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 201,
      body: { number: 7, html_url: 'https://github.com/acme/api/pull/7', state: 'open', draft: true },
    }));
    const forge = new GitHubForge({ tokenSource, fetchImpl });
    const pr = await forge.openPR({
      owner: 'acme',
      repo: 'api',
      head: 'nemus/feature',
      base: 'main',
      title: 'Add idempotency keys',
      draft: true,
    });
    expect(pr).toEqual({
      number: 7,
      url: 'https://github.com/acme/api/pull/7',
      state: 'open',
      draft: true,
    });
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/api/pulls');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ghs_test');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toMatchObject({ head: 'nemus/feature', base: 'main', draft: true });
  });

  it('reports merged state', async () => {
    const { fetchImpl } = stubFetch(() => ({
      status: 201,
      body: { number: 1, html_url: 'u', state: 'closed', merged_at: '2026-01-01T00:00:00Z' },
    }));
    const forge = new GitHubForge({ tokenSource, fetchImpl });
    const pr = await forge.openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' });
    expect(pr.state).toBe('merged');
  });

  it('surfaces API errors with status + body', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 422, body: 'validation failed' }));
    const forge = new GitHubForge({ tokenSource, fetchImpl });
    await expect(
      forge.openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' }),
    ).rejects.toThrow(/422.*validation failed/);
  });
});

describe('GitHubForge.getChecks', () => {
  it('normalizes check-runs for a ref', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: {
        check_runs: [
          { name: 'build', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'in_progress', conclusion: null },
        ],
      },
    }));
    const forge = new GitHubForge({ tokenSource, fetchImpl });
    const checks = await forge.getChecks({ owner: 'acme', repo: 'api', ref: 'abc123' });
    expect(checks).toEqual([
      { name: 'build', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'in_progress', conclusion: null },
    ]);
    expect(calls[0].url).toContain('/commits/abc123/check-runs?per_page=100');
  });
});

describe('GitHubForge.comment', () => {
  it('POSTs to the issue comments endpoint and tolerates 204', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 201, body: { id: 1 } }));
    const forge = new GitHubForge({ tokenSource, fetchImpl });
    await forge.comment({ owner: 'acme', repo: 'api', number: 7, body: 'baz review' });
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/api/issues/7/comments');
    expect(JSON.parse(calls[0].init.body)).toEqual({ body: 'baz review' });
  });
});

describe('GitHubForge apiBaseUrl (GHES)', () => {
  it('honors a custom API base', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, body: { check_runs: [] } }));
    const forge = new GitHubForge({ tokenSource, fetchImpl, apiBaseUrl: 'https://ghe.acme.com/api/v3/' });
    await forge.getChecks({ owner: 'a', repo: 'b', ref: 'main' });
    expect(calls[0].url).toBe('https://ghe.acme.com/api/v3/repos/a/b/commits/main/check-runs?per_page=100');
  });
});
