/**
 * Machine-readable output helpers. The one rule: a command's DATA goes to
 * stdout, diagnostics go to stderr (see logger.ts). In `--json` mode a command
 * writes exactly one JSON document to stdout and nothing else, so it pipes
 * cleanly into `jq` and is safe for scripts/CI.
 */

/** Write one pretty-printed JSON document to stdout (data channel). */
export function outputJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Emit a structured error as JSON to stdout for `--json` callers (so a script
 * parsing stdout gets a parseable object rather than a human log line on
 * stderr), then signal failure via the returned exit code.
 */
export function outputJsonError(message: string): void {
  outputJson({ ok: false, error: message });
}
