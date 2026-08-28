import { execFileSync } from 'child_process';
import { getPrimaryAgent } from './agent-config';

/**
 * Run the user's configured coding agent headlessly as an "LLM-as-a-judge":
 * feed it a prompt, get back a parsed JSON object. This reuses whatever agent
 * the user already has authenticated (claude / pi / opencode) — no API keys of
 * our own. It mirrors the lean, structured invocation used for intent
 * extraction, but generalized (any prompt + optional JSON schema).
 *
 * The call is bounded by a timeout and a large maxBuffer; a transcript-analysis
 * judge returns more than intent extraction, so the buffer is generous.
 */
export interface JudgeOptions {
  /** JSON schema string passed to `claude --json-schema` (ignored by others). */
  schema?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  /** Injected for tests. Defaults to the real child_process runner. */
  exec?: (cmd: string, args: string[], opts: { timeout: number; maxBuffer: number }) => string;
  /** Injected for tests. Defaults to the configured primary agent. */
  agentType?: 'claude' | 'pi' | 'opencode' | 'codex' | 'gemini';
}

const DEFAULT_TIMEOUT_MS = 180_000; // judging N transcripts is heavier than extraction
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Invoke the agent with `prompt` and return the raw stdout. Throws a clear error
 * on timeout / non-zero exit. Kept separate from parsing so callers can inspect
 * raw output (e.g. `--dry-run`, debugging).
 */
export function runAgentRaw(prompt: string, opts: JudgeOptions = {}): string {
  const agentType = opts.agentType ?? getPrimaryAgent().type;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const exec =
    opts.exec ??
    ((cmd, args, o) => execFileSync(cmd, args, { encoding: 'utf-8', timeout: o.timeout, maxBuffer: o.maxBuffer }));

  const attempt = (cmd: string, args: string[]) => exec(cmd, args, { timeout, maxBuffer });

  try {
    if (agentType === 'claude') {
      const preferred = ['-p', prompt, '--output-format', 'json', '--bare', '--strict-mcp-config', '--disable-slash-commands'];
      if (opts.schema) preferred.push('--json-schema', opts.schema);
      try {
        return attempt('claude', preferred);
      } catch {
        // Older claude may reject the newer flags — fall back to the plainest form.
        return attempt('claude', ['-p', prompt]);
      }
    }
    if (agentType === 'opencode') {
      return attempt('opencode', ['run', prompt]);
    }
    // pi (and any other): run as lean as possible so a bloated env can't hang it.
    const piLean = ['--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-tools', '--no-session'];
    try {
      return attempt('pi', [...piLean, '-p', prompt]);
    } catch {
      return attempt('pi', ['-p', prompt]);
    }
  } catch (err: any) {
    const detail = (err?.stderr || err?.stdout || err?.message || 'unknown error').toString().trim().slice(0, 500);
    throw new Error(`agent judge failed (${agentType}): ${detail}`);
  }
}

/**
 * Run the agent and parse its reply as JSON, tolerating the shapes different
 * agents emit: `{ structured_output }`, `{ result: "<json>" }`, a ```json fence,
 * or a bare object. Returns `unknown`; callers validate/normalize their shape.
 */
export function runAgentJson(prompt: string, opts: JudgeOptions = {}): unknown {
  const raw = runAgentRaw(prompt, opts);
  return parseAgentJson(raw);
}

/** Extract a JSON object from an agent's raw stdout. Exported for tests. */
export function parseAgentJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) text = fence[1].trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Last resort: grab the outermost {...} span.
    const span = text.match(/\{[\s\S]*\}/);
    if (!span) throw new Error('agent did not return JSON');
    parsed = JSON.parse(span[0]);
  }

  // Unwrap the common agent envelopes.
  if (parsed && typeof parsed === 'object') {
    if (parsed.structured_output && typeof parsed.structured_output === 'object') return parsed.structured_output;
    if (typeof parsed.result === 'string') {
      try {
        return JSON.parse(parsed.result);
      } catch {
        /* fall through — result was plain text, return the envelope */
      }
    }
    if (parsed.result && typeof parsed.result === 'object') return parsed.result;
  }
  return parsed;
}
