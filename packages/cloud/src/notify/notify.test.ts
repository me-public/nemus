import { describe, it, expect } from 'vitest';
import { formatSlackText, SlackNotifier } from './slack';
import { WebhookNotifier, MultiNotifier, NoopNotifier } from './webhook';
import { notifierFromEnv } from './index';
import { FetchLike, Notification } from './types';

const ok: FetchLike = async () => ({ ok: true, status: 200, text: async () => '' });

function recorder(res: Partial<{ ok: boolean; status: number; body: string }> = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: res.ok ?? true, status: res.status ?? 200, text: async () => res.body ?? '' };
  };
  return { fetch, calls };
}

const pr: Notification = { event: 'pr_opened', title: 'opened PR', repo: 'acme/api', url: 'https://x/pr/1', body: 'details' };

describe('formatSlackText', () => {
  it('includes emoji, title, repo, body, url', () => {
    const t = formatSlackText(pr);
    expect(t).toContain('*opened PR*');
    expect(t).toContain('_acme/api_');
    expect(t).toContain('details');
    expect(t).toContain('https://x/pr/1');
  });
});

describe('SlackNotifier', () => {
  it('POSTs { text } to the webhook', async () => {
    const { fetch, calls } = recorder();
    await new SlackNotifier({ webhookUrl: 'https://hook', fetch }).notify(pr);
    expect(calls[0].url).toBe('https://hook');
    expect(JSON.parse(calls[0].body).text).toContain('opened PR');
  });
  it('throws on a non-2xx response', async () => {
    const { fetch } = recorder({ ok: false, status: 500, body: 'boom' });
    await expect(new SlackNotifier({ webhookUrl: 'h', fetch }).notify(pr)).rejects.toThrow(/slack webhook failed \(500\)/);
  });
  it('requires a webhookUrl', () => {
    expect(() => new SlackNotifier({ webhookUrl: '' })).toThrow(/webhookUrl/);
  });
});

describe('WebhookNotifier', () => {
  it('POSTs the raw Notification as JSON', async () => {
    const { fetch, calls } = recorder();
    await new WebhookNotifier({ url: 'https://sink', fetch }).notify(pr);
    expect(JSON.parse(calls[0].body)).toMatchObject({ event: 'pr_opened', repo: 'acme/api' });
  });
});

describe('MultiNotifier', () => {
  it('fans out best-effort — one failure does not block the others', async () => {
    const hit: string[] = [];
    const good = { id: 'g', notify: async () => { hit.push('g'); } };
    const bad = { id: 'b', notify: async () => { hit.push('b'); throw new Error('nope'); } };
    await new MultiNotifier([bad, good]).notify(pr); // must not throw
    expect(hit.sort()).toEqual(['b', 'g']);
  });
});

describe('notifierFromEnv', () => {
  it('no config → Noop (no fetch)', async () => {
    const { fetch, calls } = recorder();
    const n = notifierFromEnv({}, fetch);
    expect(n).toBeInstanceOf(NoopNotifier);
    await n.notify(pr);
    expect(calls).toHaveLength(0);
  });
  it('slack only → SlackNotifier', () => {
    expect(notifierFromEnv({ SLACK_WEBHOOK_URL: 'h' }, ok).id).toBe('slack');
  });
  it('both → MultiNotifier fanning to two sinks', async () => {
    const { fetch, calls } = recorder();
    const n = notifierFromEnv({ SLACK_WEBHOOK_URL: 'h1', NEMUS_WEBHOOK_URL: 'h2' }, fetch);
    expect(n.id).toBe('multi');
    await n.notify(pr);
    expect(calls.map((c) => c.url).sort()).toEqual(['h1', 'h2']);
  });
});
