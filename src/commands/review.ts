import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { resolveWorkspace, getGlobalOpts, parseList } from '../utils/command-helpers';
import { runAgentJsonAsync } from '../utils/agent-judge';
import {
  collectRepoDiff,
  buildReviewPrompt,
  parseReviewResult,
  filterBySeverity,
  formatReview,
  REVIEW_SCHEMA,
  SEVERITY_ORDER,
  type RepoDiff,
  type Severity,
} from '../utils/review-analyzer';
import { logError, logInfo, logWarning } from '../utils/logger';
import { outputJson, outputJsonError } from '../utils/output';
import { colorize } from '../utils/colors';

export function registerReviewCommand(parent: Command) {
  parent
    .command('review [workspace]')
    .description('AI code review of the uncommitted changes across a workspace, using your configured agent')
    .option('--only <repos>', 'Comma-separated subset of repos to review')
    .option('--staged', 'Review only staged changes (git diff --cached)')
    .option('--base <ref>', 'Review committed changes on the current branch vs <ref> (e.g. main)')
    .option('--severity <level>', `Minimum severity to report: ${SEVERITY_ORDER.join(' | ')}`)
    .option('--model <model>', 'Model to use (passed to your agent)')
    .option('--thinking <level>', 'Thinking level (pi only): off|minimal|low|medium|high')
    .option('--json', 'Output findings as JSON')
    .option('--dry-run', 'Print the prompt that would be sent, without calling the agent')
    .action(async (workspace, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleReview({ workspace, ...opts, ...globalOpts });
    });
}

function resolveSeverity(raw: string | undefined, json?: boolean): Severity | undefined {
  if (raw === undefined) return undefined;
  if ((SEVERITY_ORDER as string[]).includes(raw)) return raw as Severity;
  const msg = `--severity must be one of: ${SEVERITY_ORDER.join(', ')}; got "${raw}"`;
  if (json) outputJsonError(msg);
  else logError(msg);
  process.exit(1);
}

/** Minimal stderr spinner with elapsed seconds; returns stop(). */
function startSpinner(label: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(label + '\n');
    return () => {};
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const start = Date.now();
  let i = 0;
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    process.stderr.write(`\r${colorize(frames[i++ % frames.length], 'cyan')} ${label} ${colorize(`${s}s`, 'gray')}`);
  }, 100);
  return () => {
    clearInterval(timer);
    process.stderr.write('\r\x1b[2K'); // clear the line
  };
}

async function handleReview(opts: {
  workspace?: string;
  only?: string;
  staged?: boolean;
  base?: string;
  severity?: string;
  model?: string;
  thinking?: string;
  json?: boolean;
  dryRun?: boolean;
}) {
  const minSeverity = resolveSeverity(opts.severity, opts.json);
  try {
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      const msg = `Workspace not found: ${workspaceName}`;
      if (opts.json) outputJsonError(msg); else logError(msg);
      process.exit(1);
    }

    let repos = metadata.repositories.filter(r => r.status === 'success');
    if (opts.only) {
      const wanted = new Set(parseList(opts.only));
      repos = repos.filter(r => wanted.has(r.directoryName) || wanted.has(r.name));
    }

    // Collect diffs (skip clean repos).
    const diffs: RepoDiff[] = [];
    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const diff = await collectRepoDiff(repoPath, { staged: opts.staged, base: opts.base });
      if (diff.trim().length > 0) {
        diffs.push({ repo: repo.directoryName, diff, truncated: false });
      }
    }

    if (diffs.length === 0) {
      const what = opts.base ? `vs ${opts.base}` : opts.staged ? 'staged' : 'uncommitted';
      const msg = `No ${what} changes to review in "${workspaceName}".`;
      if (opts.json) outputJson({ workspace: workspaceName, summary: msg, findings: [] });
      else logInfo(msg);
      return;
    }

    const prompt = buildReviewPrompt(diffs);

    if (opts.dryRun) {
      if (opts.json) outputJson({ workspace: workspaceName, repos: diffs.map(d => d.repo), prompt });
      else process.stdout.write(prompt + '\n');
      return;
    }

    const timeoutMs = Number.parseInt(process.env.NEMUS_JUDGE_TIMEOUT_MS ?? '', 10) || undefined;
    const model = opts.model ?? process.env.NEMUS_JUDGE_MODEL ?? undefined;
    const thinking = opts.thinking ?? process.env.NEMUS_JUDGE_THINKING ?? undefined;

    const stop = opts.json
      ? () => {}
      : startSpinner(`Reviewing ${diffs.length} repo(s) with your configured agent (this can take a minute)…`);
    let parsed: unknown;
    try {
      parsed = await runAgentJsonAsync(prompt, { schema: REVIEW_SCHEMA, timeoutMs, model, thinking });
    } finally {
      stop();
    }

    const result = parseReviewResult(parsed);
    if (minSeverity) result.findings = filterBySeverity(result.findings, minSeverity);

    if (opts.json) {
      outputJson({ workspace: workspaceName, repos: diffs.map(d => d.repo), ...result });
      return;
    }
    console.log(formatReview(result));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to review workspace';
    if (opts.json) outputJsonError(msg); else logError(msg);
    process.exit(1);
  }
}
