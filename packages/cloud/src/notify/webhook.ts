import { FetchLike, Notification, Notifier } from './types';

export interface WebhookNotifierOptions {
  url: string;
  fetch?: FetchLike;
}

/** Generic webhook: POSTs the raw Notification as JSON (Discord/custom sinks). */
export class WebhookNotifier implements Notifier {
  readonly id = 'webhook';
  private readonly url: string;
  private readonly fetch: FetchLike;

  constructor(opts: WebhookNotifierOptions) {
    if (!opts.url) throw new Error('WebhookNotifier requires a url');
    this.url = opts.url;
    this.fetch = opts.fetch ?? ((u, init) => fetch(u, init));
  }

  async notify(n: Notification): Promise<void> {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(n),
    });
    if (!res.ok) {
      throw new Error(`webhook failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  }
}

/** Fans a notification out to several notifiers, best-effort (one failure never
 *  blocks the others, and never throws — notifications must not break a run). */
export class MultiNotifier implements Notifier {
  readonly id = 'multi';
  constructor(private readonly children: Notifier[]) {}

  async notify(n: Notification): Promise<void> {
    await Promise.allSettled(this.children.map((c) => c.notify(n)));
  }
}

/** A no-op notifier so callers can always `notify()` unconditionally. */
export class NoopNotifier implements Notifier {
  readonly id = 'noop';
  async notify(): Promise<void> {
    /* nothing configured */
  }
}
