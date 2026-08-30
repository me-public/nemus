import { execFileSync, spawn } from 'child_process';
import { getPrimaryAgent } from './agent-config';

/**
 * Run a child to completion, capturing stdout, with stdin set to /dev/null.
 *
 * The stdin part is load-bearing: agents like `pi` block waiting on stdin if
 * it's an open pipe (the default for execFile), which made the judge hang until
 * the timeout regardless of prompt size or model speed. `stdio: ['ignore', …]`
 * gives the child an immediate EOF, exactly like a non-interactive shell.
 */
export function spawnCollect(
  cmd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > opts.maxBuffer) {
        overflow = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code, signal) => {
      if (overflow) return reject(Object.assign(new Error('maxBuffer exceeded'), { stdout, stderr }));
      if (signal) return reject(Object.assign(new Error(`killed by ${signal}`), { killed: true, signal, stdout, stderr }));
      if (code !== 0) return reject(Object.assign(new Error(`exit ${code}`), { code, stdout, stderr }));
      resolve(stdout);
    });
  });
}

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
  /** Model override (`--model`), agent-native pattern/id. */
  model?: string;
  /** Thinking level (`--thinking`, pi only): off|minimal|low|medium|high|xhigh|max. */
  thinking?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  /** Injected for tests. Defaults to the real (blocking) child_process runner. */
  exec?: (cmd: string, args: string[], opts: { timeout: number; maxBuffer: number }) => string;
  /** Injected for tests. Async runner used by the non-blocking variants. */
  execAsync?: (cmd: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<string>;
  /** Injected for tests. Defaults to the configured primary agent. */
  agentType?: 'claude' | 'pi' | 'opencode' | 'codex' | 'gemini';
}

export type JudgeAgentType = NonNullable<JudgeOptions['agentType']>;

export interface AgentAttempt {
  cmd: string;
  args: string[];
}

export interface AttemptOptions {
  schema?: string;
  model?: string;
  thinking?: string;
}

/**
 * Default thinking level for the judge. The judge is a mechanical transform
 * (facts → recommendations), not deep reasoning, so a heavy default like Opus
 * @ medium thinking just makes it slow. `low` keeps pi fast; override per-run.
 */
export const DEFAULT_JUDGE_THINKING = 'low';

/**
 * The ordered invocation attempts for an agent (preferred → fallback), as pure
 * data so both the sync and async runners share ONE flag ladder (and it's
 * unit-testable without spawning anything). `--model` applies to all; pi also
 * takes `--thinking` (the speed lever); both are ignored where unsupported.
 */
export function agentAttempts(agentType: JudgeAgentType, prompt: string, opts: AttemptOptions = {}): AgentAttempt[] {
  const { schema, model, thinking } = opts;
  if (agentType === 'claude') {
    const preferred = ['-p', prompt, '--output-format', 'json', '--bare', '--strict-mcp-config', '--disable-slash-commands'];
    if (model) preferred.push('--model', model);
    if (schema) preferred.push('--json-schema', schema);
    // Older claude may reject the newer flags — fall back to the plainest form.
    const plain = ['-p', prompt];
    if (model) plain.push('--model', model);
    return [{ cmd: 'claude', args: preferred }, { cmd: 'claude', args: plain }];
  }
  if (agentType === 'opencode') {
    const args = ['run', prompt];
    if (model) args.push('--model', model);
    return [{ cmd: 'opencode', args }];
  }
  // pi (and any other): run as lean as possible so a bloated env can't hang it.
  const piLean = ['--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-tools', '--no-session'];
  const tune: string[] = [];
  if (model) tune.push('--model', model);
  if (thinking) tune.push('--thinking', thinking);
  return [
    { cmd: 'pi', args: [...piLean, ...tune, '-p', prompt] },
    { cmd: 'pi', args: [...tune, '-p', prompt] },
  ];
}

/** Resolve the attempt options for a run, applying the pi thinking default. */
function attemptOptions(agentType: JudgeAgentType, opts: JudgeOptions): AttemptOptions {
  return {
    schema: opts.schema,
    model: opts.model,
    thinking: opts.thinking ?? (agentType === 'pi' ? DEFAULT_JUDGE_THINKING : undefined),
  };
}

function wrapJudgeError(err: any, agentType: string): Error {
  // A timeout is the common failure (big prompt + slow local model), so make it
  // actionable instead of surfacing a raw `spawn … ETIMEDOUT`.
  if (err?.killed || err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM' || /ETIMEDOUT/.test(String(err?.message ?? ''))) {
    return new Error(
      `agent judge (${agentType}) timed out. Try a smaller --limit, a faster agent, or raise the cap with NEMUS_JUDGE_TIMEOUT_MS.`,
    );
  }
  const detail = (err?.stderr || err?.stdout || err?.message || 'unknown error').toString().trim().slice(0, 500);
  return new Error(`agent judge failed (${agentType}): ${detail}`);
}

const DEFAULT_TIMEOUT_MS = 300_000; // judging N transcripts is heavier than extraction; a big prompt + slow model can run minutes
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
    // `input: ''` closes the child's stdin (EOF) so a stdin-reading agent (pi)
    // can't hang the synchronous call — the sync twin of spawnCollect's fix.
    ((cmd, args, o) => execFileSync(cmd, args, { encoding: 'utf-8', input: '', timeout: o.timeout, maxBuffer: o.maxBuffer }));

  const attempts = agentAttempts(agentType, prompt, attemptOptions(agentType, opts));
  let lastErr: any;
  for (const a of attempts) {
    try {
      return exec(a.cmd, a.args, { timeout, maxBuffer });
    } catch (err) {
      lastErr = err; // try the next (fallback) form
    }
  }
  throw wrapJudgeError(lastErr, agentType);
}

/**
 * Non-blocking twin of {@link runAgentRaw}. Uses `execFile` (async) so the
 * caller's event loop stays free — letting a spinner/progress UI animate while
 * the judge (which can take minutes) runs. Prefer this in interactive commands.
 */
export async function runAgentRawAsync(prompt: string, opts: JudgeOptions = {}): Promise<string> {
  const agentType = opts.agentType ?? getPrimaryAgent().type;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const exec = opts.execAsync ?? ((cmd, args, o) => spawnCollect(cmd, args, o));

  const attempts = agentAttempts(agentType, prompt, attemptOptions(agentType, opts));
  let lastErr: any;
  for (const a of attempts) {
    try {
      return await exec(a.cmd, a.args, { timeout, maxBuffer });
    } catch (err) {
      lastErr = err; // try the next (fallback) form
    }
  }
  throw wrapJudgeError(lastErr, agentType);
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

/** Non-blocking twin of {@link runAgentJson}. */
export async function runAgentJsonAsync(prompt: string, opts: JudgeOptions = {}): Promise<unknown> {
  const raw = await runAgentRawAsync(prompt, opts);
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
