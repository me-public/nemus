import { FetchLike, Notifier } from './types';
import { SlackNotifier } from './slack';
import { MultiNotifier, NoopNotifier, WebhookNotifier } from './webhook';

export * from './types';
export { SlackNotifier, formatSlackText } from './slack';
export type { SlackNotifierOptions } from './slack';
export { WebhookNotifier, MultiNotifier, NoopNotifier } from './webhook';
export type { WebhookNotifierOptions } from './webhook';

/**
 * Build a Notifier from the environment (opt-in). Reads:
 *   SLACK_WEBHOOK_URL  → Slack incoming webhook
 *   NEMUS_WEBHOOK_URL  → generic JSON webhook
 * Zero configured → a NoopNotifier, so callers can always call notify()
 * unconditionally; several configured → a best-effort MultiNotifier.
 */
export function notifierFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): Notifier {
  const notifiers: Notifier[] = [];
  if (env.SLACK_WEBHOOK_URL) notifiers.push(new SlackNotifier({ webhookUrl: env.SLACK_WEBHOOK_URL, fetch: fetchImpl }));
  if (env.NEMUS_WEBHOOK_URL) notifiers.push(new WebhookNotifier({ url: env.NEMUS_WEBHOOK_URL, fetch: fetchImpl }));
  if (notifiers.length === 0) return new NoopNotifier();
  if (notifiers.length === 1) return notifiers[0];
  return new MultiNotifier(notifiers);
}
