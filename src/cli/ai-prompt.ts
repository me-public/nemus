import { spawn, exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WORKSPACES_DIR } from '../utils/config';
import { logInfo, logError, logStep } from '../utils/logger';
import { colorize } from '../utils/colors';
import { getPrimaryAgent } from '../utils/agent-config';

const execAsync = promisify(exec);

export const AI_PROMPT_FILE = path.join(os.homedir(), '.workspace-ai-prompt');

const EXTRACT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    workspaceName: { type: 'string', description: 'Workspace name (kebab-case, e.g. "payments-team")' },
    repos: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repository names to clone (e.g. ["api", "web"])',
    },
    remainingIntent: {
      type: 'string',
      description: 'What the user wants done AFTER workspace creation (empty string if nothing beyond creating the workspace)',
    },
  },
  required: ['workspaceName', 'repos', 'remainingIntent'],
});

/**
 * Build the extraction prompt for parsing workspace details from natural language.
 */
export function buildExtractionPrompt(userPrompt: string): string {
  return `Extract the workspace name and repository names from this request. If the user didn't specify a workspace name, generate a short descriptive kebab-case name. Repository names should be exact GitHub repo names (without org prefix). If the user's request includes things to do AFTER creating the workspace (like fixing code, creating branches, etc.), put that in remainingIntent.

Respond with ONLY a raw JSON object (no markdown, no backticks, no explanation). The JSON must have exactly these fields:
{"workspaceName": "short-kebab-name", "repos": ["repo-name-1", "repo-name-2"], "remainingIntent": "what to do after creation or empty string"}

User request: ${userPrompt}`;
}

/**
 * Check if the primary agent CLI is available on the system.
 */
export async function isPrimaryAgentAvailable(): Promise<boolean> {
  const agent = getPrimaryAgent();
  try {
    await execAsync(`which ${agent.launchCommand}`);
    return true;
  } catch {
    return false;
  }
}

// Backward compat alias
export const isClaudeAvailable = isPrimaryAgentAvailable;

interface ExtractedIntent {
  workspaceName: string;
  repos: string[];
  remainingIntent: string;
}

/**
 * Use the configured AI agent to extract structured workspace details from a natural language prompt.
 */
// Extraction is a tiny JSON task, but the underlying model call can stall
// intermittently — e.g. a slow/large default model (Opus) plus provider
// retries/backoff (Bedrock rate-limits), or a cold agent startup. 60s was
// too tight and produced flaky `spawnSync ETIMEDOUT`. 120s gives those
// transient cases room while still bounding a genuine hang.
const EXTRACTION_TIMEOUT_MS = 120_000;

/**
 * Run an agent CLI for intent extraction, turning a timeout or non-zero exit
 * into a clear, actionable error (instead of a cryptic `spawnSync ETIMEDOUT`).
 *
 * `fullArgs` is the preferred (lean) invocation. `fallbackArgs`, when provided,
 * is a plainer invocation retried ONCE if the lean run fails fast (i.e. not a
 * timeout or buffer overflow) — this covers older agent versions that reject
 * newer speed flags like `--bare` / `--no-extensions` with an instant non-zero
 * exit. Older versions then still work (just without the speedup).
 */
function runExtraction(cmd: string, fullArgs: string[], fallbackArgs?: string[]): string {
  const exec = (args: string[]) =>
    execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: EXTRACTION_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

  const classify = (err: any) => {
    const message = String(err?.message ?? '');
    return {
      timedOut: err?.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(message),
      bufferOverflow: err?.code === 'ENOBUFS' || /maxBuffer/i.test(message),
      stderr: typeof err?.stderr === 'string' ? err.stderr.trim() : '',
      stdout: typeof err?.stdout === 'string' ? err.stdout.trim() : '',
      message,
    };
  };

  try {
    return exec(fullArgs);
  } catch (err: any) {
    const c = classify(err);

    // Fast failure (unsupported flag, etc.) on the lean invocation — retry
    // once with the plainer args so older agent versions still work.
    if (fallbackArgs && !c.timedOut && !c.bufferOverflow) {
      try {
        return exec(fallbackArgs);
      } catch (err2: any) {
        return throwExtractionError(cmd, classify(err2));
      }
    }
    return throwExtractionError(cmd, c);
  }
}

function throwExtractionError(
  cmd: string,
  c: { timedOut: boolean; bufferOverflow: boolean; stderr: string; stdout: string; message: string },
): never {
  const testCmd = cmd === 'opencode'
    ? `opencode run "reply with OK"`
    : `${cmd} -p "reply with OK"`;
  // claude -p --output-format json emits error details on stdout, not stderr.
  const detail = c.stderr || c.stdout;

  if (c.timedOut) {
    const secs = Math.round(EXTRACTION_TIMEOUT_MS / 1000);
    let msg =
      `${cmd} did not respond within ${secs}s while parsing your request.\n` +
      `  This is usually a transient model/provider stall, not a workspace-manager bug.\n` +
      `  • Verify the agent itself responds quickly:  time ${testCmd}\n` +
      `  • If it's slow, your default model may be heavy (e.g. Opus) or the provider\n` +
      `    may be rate-limiting/refreshing credentials. Retry, or switch to a faster model.\n` +
      `  • You can still create the workspace manually:  w create --workspace <name> --repos <repos>`;
    if (detail) msg += `\n  agent output: ${detail.slice(0, 500)}`;
    throw new Error(msg);
  }

  if (c.bufferOverflow) {
    throw new Error(
      `${cmd} produced more output than expected while parsing your request ` +
      `(maxBuffer exceeded). Try a shorter request, or create the workspace ` +
      `manually:  w create --workspace <name> --repos <repos>` +
      (detail ? `\n  agent output: ${detail.slice(0, 500)}` : ''),
    );
  }

  throw new Error(
    `${cmd} failed while parsing your request.\n` +
    `  • Verify the agent works:  ${testCmd}\n` +
    `  • Or create the workspace manually:  w create --workspace <name> --repos <repos>` +
    (detail ? `\n  agent output: ${detail.slice(0, 800)}` : ` (${c.message || 'unknown error'})`),
  );
}

export async function extractIntent(prompt: string): Promise<ExtractedIntent> {
  const extractionPrompt = buildExtractionPrompt(prompt);
  const agent = getPrimaryAgent();

  let result: string;
  if (agent.type === 'claude') {
    // Preferred: structured + lean. --output-format/--json-schema give clean
    // structured output; --bare/--strict-mcp-config/--disable-slash-commands
    // skip the heavy ~/.claude (hooks, MCP servers, skills, plugins, context)
    // so a bloated setup can't time out.
    const preferred = [
      '-p', extractionPrompt,
      '--output-format', 'json',
      '--json-schema', EXTRACT_SCHEMA,
      '--bare',
      '--strict-mcp-config',
      '--disable-slash-commands',
    ];
    // Fallback: the most basic invocation that works on ANY claude version.
    // If the user's claude rejects ANY of the flags above (it exits instantly
    // non-zero), retry with plain `-p <prompt>` and parse the raw JSON text
    // (same approach as pi). The extraction prompt already asks for raw JSON.
    const fallback = ['-p', extractionPrompt];
    result = runExtraction('claude', preferred, fallback);
  } else if (agent.type === 'opencode') {
    // OpenCode: use 'run' subcommand with positional message argument
    result = runExtraction('opencode', ['run', extractionPrompt]);
  } else {
    // Pi: run as LEAN as possible. Intent extraction is a pure text->JSON
    // transform that needs no extensions, skills, prompt-templates, context
    // files, tools, or saved session. Loading the user's full environment
    // (especially many MCP tools/skills or a large AGENTS.md context) is what
    // made `pi -p` slow enough to blow past the timeout on bloated setups.
    // These flags also avoid spawning MCP servers / credential-refresh
    // extensions that can hang a non-interactive subprocess.
    const piCore = ['-p', extractionPrompt];
    const piLean = [
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-tools',
      '--no-session',
    ];
    result = runExtraction('pi', [...piLean, ...piCore], piCore);
  }

  // Strip markdown code fences if present (Pi may wrap JSON in ```json...```)
  let jsonStr = result.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  // Handle different output formats:
  // - Claude: { structured_output: {...} } or { result: "..." }
  // - Pi: may return the object directly or wrap it
  let intent: ExtractedIntent | undefined;
  if (parsed.structured_output) {
    intent = parsed.structured_output;
  } else if (typeof parsed.result === 'string' && parsed.result) {
    try { intent = JSON.parse(parsed.result); } catch { /* ignore */ }
  } else if (typeof parsed.result === 'object' && parsed.result !== null) {
    intent = parsed.result;
  } else if (parsed.workspaceName || parsed.repos || parsed.remainingIntent !== undefined) {
    // Pi may return the extracted object directly
    intent = parsed;
  }

  if (!intent) {
    throw new Error(`Could not extract intent from agent response. Parsed: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return intent;
}

/**
 * Run the AI prompt command.
 *
 * 1. Extract workspace name + repos from the prompt (fast, no tool use).
 * 2. Create the workspace using the CLI directly (shows progress).
 * 3. Shell integration CDs to workspace and launches interactive Claude.
 */
export async function run(prompt: string): Promise<number> {
  const agentAvailable = await isClaudeAvailable();
  if (!agentAvailable) {
    const agent = getPrimaryAgent();
    logError(`${agent.type} CLI not found. Install it first.`);
    return 1;
  }

  const displayPrompt = prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt;
  logInfo(`AI prompt: ${colorize(displayPrompt, 'cyan')}`);

  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

  // Step 1: Extract workspace details from natural language
  logStep(1, 2, 'Understanding request...');
  let intent: ExtractedIntent;
  try {
    intent = await extractIntent(prompt);
  } catch (err) {
    logError('Failed to parse workspace request');
    if (err instanceof Error) logError(err.message);
    return 1;
  }

  const repos = Array.isArray(intent.repos) ? intent.repos : [];
  if (!intent.workspaceName || repos.length === 0) {
    logError('Could not determine workspace name or repos from prompt');
    logInfo(`Parsed: name=${intent.workspaceName || '(none)'}, repos=${repos.join(', ') || '(none)'}`);
    return 1;
  }

  logInfo(`Workspace: ${colorize(intent.workspaceName, 'cyan')}, Repos: ${colorize(repos.join(', '), 'cyan')}`);

  // Save remaining intent for the follow-up interactive session
  const remaining = intent.remainingIntent || prompt;
  try { fs.writeFileSync(AI_PROMPT_FILE, remaining, 'utf-8'); } catch {}

  // Step 2: Create workspace using the CLI directly
  logStep(2, 2, 'Creating workspace...');
  return new Promise<number>((resolve) => {
    const child = spawn('w', [
      'create',
      '--workspace', intent.workspaceName,
      '--repos', repos.join(','),
      '--prompt', prompt,
      '--yes',
    ], {
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      logError(`Failed to create workspace: ${err.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code || 0);
    });
  });
}

export async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(' ').trim();

  if (!prompt) {
    logError('No prompt provided');
    console.log(`\n  Usage: ${colorize('w -- <prompt>', 'green')}`);
    console.log(`  Example: ${colorize('w -- create a workspace for the payments team', 'gray')}\n`);
    process.exit(1);
    return;
  }

  const exitCode = await run(prompt);
  process.exit(exitCode);
}
