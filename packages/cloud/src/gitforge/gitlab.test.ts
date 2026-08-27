import { describe, it, expect } from 'vitest';
import { GitLabForge } from './gitlab';
import { ForgeTokenSource } from '../forge/types';

const tokenSource: ForgeTokenSource = {
  id: 'test',
  getToken: async () => ({ token: 'glpat-test', expiresAt: new Date('2030-01-01') }),
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

describe('GitLabForge.openPR', () => {
  it('POSTs a merge request with Bearer auth + GitLab field names', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 201,
      body: { iid: 7, web_url: 'https://gitlab.com/acme/api/-/merge_requests/7', state: 'opened', draft: false },
    }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    const pr = await forge.openPR({
      owner: 'acme',
      repo: 'api',
      head: 'nemus/feature',
      base: 'main',
      title: 'Add idempotency keys',
    });
    expect(pr).toEqual({
      number: 7,
      url: 'https://gitlab.com/acme/api/-/merge_requests/7',
      state: 'open',
      draft: false,
    });
    // project id is URL-encoded namespace/path
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/acme%2Fapi/merge_requests');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer glpat-test');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent).toMatchObject({ source_branch: 'nemus/feature', target_branch: 'main', title: 'Add idempotency keys' });
  });

  it('expresses draft via a "Draft:" title prefix (GitLab convention)', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 201,
      body: { iid: 1, web_url: 'u', state: 'opened', draft: true },
    }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    const pr = await forge.openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 'Feature', draft: true });
    expect(JSON.parse(calls[0].init.body).title).toBe('Draft: Feature');
    expect(pr.draft).toBe(true);
  });

  it('does not double-prefix an already-draft title', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 201, body: { iid: 1, web_url: 'u', state: 'opened' } }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    await forge.openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 'Draft: Feature', draft: true });
    expect(JSON.parse(calls[0].init.body).title).toBe('Draft: Feature');
  });

  it('reports merged + closed states, and reads legacy work_in_progress', async () => {
    const merged = stubFetch(() => ({ status: 201, body: { iid: 2, web_url: 'u', state: 'merged' } }));
    expect((await new GitLabForge({ tokenSource, fetchImpl: merged.fetchImpl }).openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' })).state).toBe('merged');

    const closed = stubFetch(() => ({ status: 201, body: { iid: 3, web_url: 'u', state: 'closed', work_in_progress: true } }));
    const pr = await new GitLabForge({ tokenSource, fetchImpl: closed.fetchImpl }).openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' });
    expect(pr.state).toBe('closed');
    expect(pr.draft).toBe(true);
  });

  it('surfaces API errors with status + body', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 409, body: { message: 'branch conflict' } }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    await expect(
      forge.openPR({ owner: 'a', repo: 'b', head: 'h', base: 'main', title: 't' }),
    ).rejects.toThrow(/409.*branch conflict/);
  });
});

describe('GitLabForge.getChecks', () => {
  it('maps commit statuses to the neutral CheckRun shape', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: [
        { name: 'build', status: 'success' },
        { name: 'test', status: 'running' },
        { name: 'lint', status: 'failed' },
        { name: 'deploy', status: 'manual' },
        { name: 'pending-job', status: 'pending' },
        { name: 'weird', status: 'something-new' },
      ],
    }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    const checks = await forge.getChecks({ owner: 'acme', repo: 'api', ref: 'abc123' });
    expect(checks).toEqual([
      { name: 'build', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'in_progress', conclusion: null },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'deploy', status: 'completed', conclusion: 'neutral' },
      { name: 'pending-job', status: 'queued', conclusion: null },
      { name: 'weird', status: 'unknown', conclusion: null },
    ]);
    expect(calls[0].url).toContain('/projects/acme%2Fapi/repository/commits/abc123/statuses?per_page=100');
  });

  it('tolerates an empty status list', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 200, body: [] }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    expect(await forge.getChecks({ owner: 'a', repo: 'b', ref: 'main' })).toEqual([]);
  });
});

describe('GitLabForge.comment', () => {
  it('POSTs a note to the MR by iid', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 201, body: { id: 1 } }));
    const forge = new GitLabForge({ tokenSource, fetchImpl });
    await forge.comment({ owner: 'acme', repo: 'api', number: 7, body: 'nemus review' });
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects/acme%2Fapi/merge_requests/7/notes');
    expect(JSON.parse(calls[0].init.body)).toEqual({ body: 'nemus review' });
  });
});

describe('GitLabForge apiBaseUrl (self-managed) + subgroups', () => {
  it('honors a custom API base and encodes subgroup owners', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, body: [] }));
    const forge = new GitLabForge({ tokenSource, fetchImpl, apiBaseUrl: 'https://gitlab.acme.com/api/v4/' });
    await forge.getChecks({ owner: 'group/subgroup', repo: 'api', ref: 'main' });
    expect(calls[0].url).toBe(
      'https://gitlab.acme.com/api/v4/projects/group%2Fsubgroup%2Fapi/repository/commits/main/statuses?per_page=100',
    );
  });
});
