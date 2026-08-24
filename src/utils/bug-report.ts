/**
 * Bug reporting — capture runtime errors and file them as GitHub issues
 * against the project repo.
 *
 * Design goals (see PR discussion):
 *  - Sanitize: never leak home dir, usernames, emails, or token-like strings.
 *  - Deduplicate: one issue per distinct error signature (search before create).
 *  - Safe: only file genuine tool errors; skip clearly-environmental ones unless
 *    forced. Auto-filing is opt-in via config (autoReportBugs).
 */

import { execFileSync } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { CACHE_DIR } from './config';

/**
 * Repo that bug issues are filed against. Overridable via NEMUS_BUG_REPORT_REPO
 * so forks/downstreams route reports to their own tracker.
 */
export const BUG_REPORT_REPO = process.env.NEMUS_BUG_REPORT_REPO || 'nemus-cli/nemus';

/** Where the most recent error is captured for `w report-bug`. */
export const LAST_ERROR_FILE = path.join(CACHE_DIR, 'last-error.json');

/** Label applied to auto-filed bug issues (used for dedup search too). */
export const BUG_LABEL = 'auto-reported';

export interface CapturedError {
  /** The command the user ran, e.g. "w update --workspace x". */
  command: string;
  message: string;
  stack?: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Tool version. */
  version?: string;
}

export interface BugReportEnv {
  version: string;
  node: string;
  os: string;
  arch: string;
}

/**
 * Redact personally-identifiable / sensitive substrings from text:
 *  - absolute home dir   -> ~
 *  - emails              -> <email>
 *  - token-ish strings   -> <redacted>
 */
export function sanitize(text: string): string {
  if (typeof text !== 'string' || !text) return text || '';
  let out = text;

  const home = os.homedir();
  if (home) {
    // Replace the literal home path everywhere it appears.
    out = out.split(home).join('~');
  }
  // /Users/<name>/ and /home/<name>/ (in case home didn't match, e.g. other users)
  out = out.replace(/\/(Users|home)\/[^/\s"']+/g, '/$1/<user>');
  // Emails
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<email>');
  // Bearer / token-like long alnum sequences (>= 24 chars with mixed case/digits)
  out = out.replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}\b/g, '<redacted>');
  // GitHub tokens
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '<redacted>');

  // Defense-in-depth: neutralize shell metacharacters so that even if the
  // text is ever interpolated into a shell (it shouldn't be — we use argv),
  // command substitution can't fire. Also keeps issue bodies clean.
  out = out.replace(/\$\(/g, '$​(').replace(/`/g, 'ˋ').replace(/\$\{/g, '$​{');

  return out;
}

/**
 * Compute a stable signature for an error so duplicates collapse to one issue.
 * Uses the normalized message (numbers/paths stripped) + top stack frame.
 */
export function errorSignature(message: string, stack?: string): string {
  const normMsg = sanitize(message || '')
    .replace(/\d+/g, 'N')          // collapse line numbers, counts, ports
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  // First stack frame that points into our own code (most stable identifier).
  let frame = '';
  if (stack) {
    const m = sanitize(stack).match(/at\s+([^\s(]+)\s*\(?([^\s)]+):\d+:\d+\)?/);
    if (m) frame = `${m[1]} ${m[2].replace(/\d+/g, 'N')}`;
  }

  return createHash('sha1').update(`${normMsg}||${frame}`).digest('hex').slice(0, 12);
}

/** Gather non-sensitive environment info for the report. */
export function gatherEnv(version: string): BugReportEnv {
  return {
    version,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
  };
}

/** Persist the most recent error so `w report-bug` can pick it up later. */
export function captureLastError(err: CapturedError): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // Sanitize before persisting so secrets/paths/emails never sit on disk
    // (the issue body re-sanitizes too — sanitize is idempotent enough here).
    const safe: CapturedError = {
      ...err,
      command: sanitize(err.command),
      message: sanitize(err.message),
      stack: err.stack ? sanitize(err.stack) : undefined,
    };
    fs.writeFileSync(LAST_ERROR_FILE, JSON.stringify(safe, null, 2), 'utf-8');
  } catch {
    /* non-critical */
  }
}

/** Read the most recent captured error, if any. */
export function readLastError(): CapturedError | null {
  try {
    const raw = JSON.parse(fs.readFileSync(LAST_ERROR_FILE, 'utf-8'));
    // Validate required fields so a malformed/old file can't crash the reporter.
    if (!raw || typeof raw !== 'object' || typeof raw.message !== 'string' || !raw.message) {
      return null;
    }
    return {
      command: typeof raw.command === 'string' ? raw.command : 'unknown',
      message: raw.message,
      stack: typeof raw.stack === 'string' ? raw.stack : undefined,
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
      version: typeof raw.version === 'string' ? raw.version : undefined,
    };
  } catch {
    return null;
  }
}

/** Heuristic: is this error clearly environmental (not a code bug)? */
export function looksEnvironmental(message: string): boolean {
  return /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EACCES|EPERM|ENOSPC|network|rate.?limit|not authenticated|gh auth|sso|credential|token expired|command not found|No such file or directory/i
    .test(message);
}

/** Build the GitHub issue title for a captured error. */
export function buildIssueTitle(err: CapturedError): string {
  const sig = errorSignature(err.message, err.stack);
  const shortMsg = sanitize(err.message).split('\n')[0].slice(0, 80);
  return `[auto] ${shortMsg} (${sig})`;
}

/** Build the GitHub issue body (fully sanitized). */
export function buildIssueBody(err: CapturedError, env: BugReportEnv): string {
  const sig = errorSignature(err.message, err.stack);
  const stack = err.stack ? sanitize(err.stack).slice(0, 4000) : '(no stack captured)';
  return [
    `**Auto-reported by workspace-manager.**`,
    ``,
    `**Signature:** \`${sig}\``,
    `**Command:** \`${sanitize(err.command)}\``,
    `**When:** ${err.timestamp}`,
    ``,
    `### Error`,
    '```',
    sanitize(err.message).slice(0, 1000),
    '```',
    ``,
    `### Stack`,
    '```',
    stack,
    '```',
    ``,
    `### Environment`,
    `| | |`,
    `|---|---|`,
    `| workspace-manager | ${env.version} |`,
    `| node | ${env.node} |`,
    `| os | ${env.os} |`,
    `| arch | ${env.arch} |`,
    ``,
    `<sub>Paths, usernames, emails, and token-like strings are redacted automatically.</sub>`,
  ].join('\n');
}

/**
 * Build the argv for listing candidate duplicate issues. Exported for testing
 * so we can assert no shell metacharacters / values are passed inertly.
 */
export function buildIssueListArgs(): string[] {
  return [
    'issue', 'list',
    '--repo', BUG_REPORT_REPO,
    '--state', 'open',
    '--label', BUG_LABEL,
    '--json', 'url,title',
    '--limit', '200',
  ];
}

/**
 * Result of a duplicate lookup. `ok: false` means the lookup itself failed
 * (gh error/timeout) — callers must NOT assume "no duplicate" in that case.
 */
export type DedupResult = { ok: true; url: string | null } | { ok: false };

/**
 * Find an existing open auto-reported issue with the same signature.
 *
 * Lists recent auto-reported issues and filters client-side on the
 * parenthesized signature in the title. We do NOT rely on GitHub's
 * free-text --search matching a hex substring, which is unreliable.
 *
 * Returns { ok:true, url } on a successful lookup (url=null = no duplicate),
 * or { ok:false } if the lookup could not be performed.
 */
export function findExistingIssue(signature: string): DedupResult {
  try {
    const out = execFileSync('gh', buildIssueListArgs(), {
      encoding: 'utf-8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const issues = JSON.parse(out) as Array<{ url: string; title: string }>;
    // Match the signature only where we put it: parenthesized at the end of
    // the title ("[auto] … (<sig>)"). Avoids matching an unrelated issue whose
    // free text happens to contain the same 12-hex substring.
    const match = issues.find((i) => i.title.includes(`(${signature})`));
    return { ok: true, url: match ? match.url : null };
  } catch {
    return { ok: false };
  }
}

/**
 * Ensure the auto-report label exists (read-or-create, best-effort).
 * Avoids re-writing the label on every issue by checking existence first.
 */
function ensureLabel(): void {
  try {
    const out = execFileSync('gh', ['label', 'list', '--repo', BUG_REPORT_REPO, '--json', 'name'], {
      encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const labels = JSON.parse(out) as Array<{ name: string }>;
    if (labels.some((l) => l.name === BUG_LABEL)) return; // already exists
  } catch {
    // couldn't list — fall through and try to create
  }
  try {
    execFileSync('gh', [
      'label', 'create', BUG_LABEL,
      '--repo', BUG_REPORT_REPO,
      '--color', 'B60205',
      '--description', 'Auto-reported by workspace-manager',
    ], { encoding: 'utf-8', timeout: 15_000, stdio: 'ignore' });
  } catch {
    /* may already exist or no perms — ignore */
  }
}

/**
 * Build the argv for creating an issue. Exported for testing: a title/body
 * containing shell metacharacters ($(…), backticks) must be passed as inert
 * argv elements, never interpolated into a shell.
 */
export function buildIssueCreateArgs(title: string, body: string): string[] {
  return [
    'issue', 'create',
    '--repo', BUG_REPORT_REPO,
    '--title', title,
    '--body', body,
    '--label', BUG_LABEL,
  ];
}

/**
 * Create a bug issue. Returns the created issue URL, or null on failure.
 *
 * Uses execFileSync with an argv array — NO shell — so title/body (derived
 * from arbitrary error text) can never trigger command substitution.
 */
export function createIssue(title: string, body: string): string | null {
  try {
    ensureLabel();
    const url = execFileSync('gh', buildIssueCreateArgs(title, body), {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const m = url.match(/https?:\/\/\S+/);
    return m ? m[0] : url || null;
  } catch {
    return null;
  }
}

export interface ReportResult {
  status: 'created' | 'duplicate' | 'skipped' | 'failed';
  url?: string;
  reason?: string;
}

/**
 * File (or dedupe) a bug report for a captured error.
 *
 * @param err     The captured error.
 * @param version Tool version string.
 * @param opts.force  Report even if the error looks environmental.
 */
export function reportBug(
  err: CapturedError,
  version: string,
  opts: { force?: boolean } = {},
): ReportResult {
  if (!opts.force && looksEnvironmental(err.message)) {
    return {
      status: 'skipped',
      reason: 'Error looks environmental (network/auth/credentials), not a code bug. Use --force to report anyway.',
    };
  }

  // gh must be available + authenticated.
  try {
    execFileSync('gh', ['auth', 'status'], { timeout: 15_000, stdio: 'ignore' });
  } catch {
    return { status: 'failed', reason: 'GitHub CLI (gh) not available or not authenticated.' };
  }

  const sig = errorSignature(err.message, err.stack);
  const dedup = findExistingIssue(sig);
  if (!dedup.ok) {
    return {
      status: 'failed',
      reason: 'Could not check for existing reports (gh issue list failed). Not filing, to avoid creating a duplicate. Please retry.',
    };
  }
  if (dedup.url) {
    return { status: 'duplicate', url: dedup.url };
  }

  const env = gatherEnv(version);
  const url = createIssue(buildIssueTitle(err), buildIssueBody(err, env));
  if (!url) return { status: 'failed', reason: 'Failed to create the GitHub issue.' };
  return { status: 'created', url };
}
