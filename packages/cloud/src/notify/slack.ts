import { FetchLike, Notification, Notifier } from './types';

const EMOJI: Record<Notification['event'], string> = {
  pr_opened: '\u{1F4DD}', // 📝
  ci_green: '\u2705', // ✅
  needs_human: '\u{1F6A8}', // 🚨
  run_failed: '\u274C', // ❌
  info: '\u2139\uFE0F', // ℹ️
};

/** Render a Notification as Slack message text. Pure + exported for tests. */
export function formatSlackText(n: Notification): string {
  const parts = [`${EMOJI[n.event] ?? ''} *${n.title}*`.trim()];
  if (n.repo) parts.push(`_${n.repo}_`);
  if (n.body) parts.push(n.body);
  if (n.url) parts.push(n.url);
  return parts.join('\n');
}

export interface SlackNotifierOptions {
  webhookUrl: string;
  fetch?: FetchLike;
  /** Abort the POST after this many ms so a hung endpoint can't stall a run (default 10_000). */
  timeoutMs?: number;
}

/** Posts to a Slack incoming webhook (`{ text }`). Zero-dep (uses fetch). */
export class SlackNotifier implements Notifier {
  readonly id = 'slack';
  private readonly webhookUrl: string;
  private readonly fetch: FetchLike;

  constructor(opts: SlackNotifierOptions) {
    if (!opts.webhookUrl) throw new Error('SlackNotifier requires a webhookUrl');
    this.webhookUrl = opts.webhookUrl;
    const timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
  }

  async notify(n: Notification): Promise<void> {
    const res = await this.fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: formatSlackText(n) }),
    });
    if (!res.ok) {
      throw new Error(`slack webhook failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  }
}
