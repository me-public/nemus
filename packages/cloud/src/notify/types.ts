/**
 * The notification seam — tell a human what a headless run did. Vendor-neutral:
 * Slack (incoming webhook) and a generic webhook ship in-box; anything else is
 * just another Notifier. Best-effort by design (a failed notification must never
 * change a run's outcome), so callers wrap in try/catch or use MultiNotifier.
 */

export type NotifyEvent =
  | 'pr_opened'
  | 'ci_green'
  | 'needs_human'
  | 'run_failed'
  | 'info';

export interface Notification {
  event: NotifyEvent;
  /** One-line summary. */
  title: string;
  /** Optional detail (failing checks, error, …). */
  body?: string;
  /** Optional PR/run URL. */
  url?: string;
  /** Optional "owner/name". */
  repo?: string;
}

export interface Notifier {
  readonly id: string;
  notify(n: Notification): Promise<void>;
}

/** Minimal fetch shape (injectable for tests; Node 22's global fetch satisfies it). */
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponse>;
