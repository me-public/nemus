import { CheckRun } from '../gitforge/types';
import { CiLoopConfig, CiLoopState } from './types';

/** Conclusions that mean a check genuinely failed (vs. neutral/skipped/success). */
const FAILING = new Set(['failure', 'timed_out', 'action_required', 'cancelled']);

export interface ChecksSummary {
  total: number;
  /** Waiting: checks are still running (or none have appeared yet) AND none have failed. */
  pending: boolean;
  /** The checks that failed. */
  failed: CheckRun[];
  /** All checks completed, at least one present, and none failed. */
  green: boolean;
}

/**
 * Reduce raw check runs to a decision. A failure short-circuits waiting (fail
 * fast rather than block on other still-running checks); zero checks counts as
 * pending (CI hasn't started / this ref has none yet) so an empty list is never
 * mistaken for green.
 */
export function summarizeChecks(checks: CheckRun[]): ChecksSummary {
  if (checks.length === 0) return { total: 0, pending: true, failed: [], green: false };
  const failed = checks.filter((c) => c.conclusion !== null && FAILING.has(c.conclusion));
  const incomplete = checks.some((c) => c.status !== 'completed');
  return {
    total: checks.length,
    pending: incomplete && failed.length === 0,
    failed,
    green: !incomplete && failed.length === 0,
  };
}

/** The instruction handed to the fix agent. Pure + exported for tests. */
export function buildFixPrompt(config: CiLoopConfig, failed: CheckRun[]): string {
  const list = failed.map((f) => `- ${f.name} (${f.conclusion ?? f.status})`).join('\n');
  return [
    'CI is failing on this pull request. Investigate the failing checks, fix the',
    'root cause, and verify locally before finishing.',
    '',
    'Failing checks:',
    list,
    '',
    `Original task: ${config.task ?? '(not provided)'}`,
    '',
    'Make the minimal change needed to make CI pass; do not touch unrelated code.',
  ].join('\n');
}

/** The comment posted when the loop gives up, so a human is told. Pure. */
export function buildGiveUpComment(state: CiLoopState, iterations: number, failed: CheckRun[]): string {
  const reason =
    state === 'exhausted'
      ? `CI is still failing after ${iterations} automated fix attempt(s)`
      : state === 'stuck'
        ? 'an automated fix produced no changes, so it can\u2019t make progress'
        : 'CI checks did not complete within the time budget';
  const list = failed.length ? `\n\nFailing checks:\n${failed.map((f) => `- ${f.name}`).join('\n')}` : '';
  return `\u{1F916} Nemus CI-loop stopped \u2014 ${reason}. This PR needs a human.${list}`;
}
