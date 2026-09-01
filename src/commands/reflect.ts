import { Command } from 'commander';
import { logError, logInfo, logStep, logWarning } from '../utils/logger';
import { outputJson, outputJsonError } from '../utils/output';
import { colorize } from '../utils/colors';
import {
  gatherReflectionCorpus,
  parseReflectionReport,
  saveReflectionReport,
  renderReportMarkdown,
  severitySummary,
  groupRecommendations,
  listSavedReports,
  findSavedMatches,
  REFLECT_SCHEMA,
  ReflectionReport,
  ReflectProgress,
  Recommendation,
  GroupBy,
} from '../utils/reflect';
import { analyzeCorpus, buildAnalysisPrompt } from '../utils/reflect-analyze';
import { runAgentJsonAsync } from '../utils/agent-judge';

export function registerReflectCommand(parent: Command) {
  parent
    .command('reflect')
    .alias('retro')
    .description('Analyze recent sessions for improvements, or review saved reports ("history"/"show")')
    .argument('[subcommand]', '"history" or "show" — omit to run a new analysis')
    .argument('[id]', 'report id when using "show" (default: latest)')
    .option('-n, --limit <n>', 'How many recent workspaces to analyze', '10')
    .option('-w, --workspace <name>', 'Analyze a single workspace by name (ignores --limit)')
    .option('--model <model>', 'Judge model override (agent-native pattern/id)')
    .option('--thinking <level>', 'Judge thinking level for pi: off|minimal|low|medium|high|xhigh|max')
    .option('--json', 'Output the report as JSON')
    .option('--markdown', 'Output the report as Markdown (paste into an issue/PR)')
    .option('--group-by <how>', 'Group recommendations by: priority | kind', 'priority')
    .option('--no-save', 'Do not save the report to ~/.nemus/reflect/')
    .option('--dry-run', 'Print the assembled corpus + judge prompt without calling the agent')
    .addHelpText(
      'after',
      '\nSaved reports:\n  nemus reflect history            List saved reports (newest first)\n  nemus reflect show [id]          Print a saved report (default: latest)\n',
    )
    // history/show are positional (not commander subcommands) on purpose: as
    // subcommands they would share --json/--markdown/--group-by with this parent
    // command, and the only commander fix (enablePositionalOptions on the root)
    // breaks global flags placed after a subcommand (e.g. `nemus list --quiet`).
    .action(async (subcommand: string | undefined, id: string | undefined, opts) => {
      if (subcommand === 'history') return handleHistory(opts);
      if (subcommand === 'show') return handleShow(id, opts);
      if (subcommand !== undefined) {
        const msg = `Unknown reflect subcommand "${subcommand}" (expected "history" or "show").`;
        if (opts.json) outputJsonError(msg);
        else logError(msg);
        process.exit(1);
      }
      return handleReflect(opts);
    });
}

/** Validate --group-by; returns the value or exits non-zero with a clear error. */
function resolveGroupBy(raw: string | undefined, json?: boolean): GroupBy {
  if (raw === undefined || raw === 'priority' || raw === 'kind') return (raw ?? 'priority') as GroupBy;
  const msg = `--group-by must be "priority" or "kind"; got "${raw}"`;
  if (json) outputJsonError(msg);
  else logError(msg);
  process.exit(1);
}

async function handleReflect(opts: {
  limit?: string;
  workspace?: string;
  model?: string;
  thinking?: string;
  json?: boolean;
  markdown?: boolean;
  groupBy?: string;
  save?: boolean; // commander sets `save: false` for --no-save
  dryRun?: boolean;
}) {
  const limit = Math.max(1, Number.parseInt(opts.limit ?? '10', 10) || 10);
  const groupBy = resolveGroupBy(opts.groupBy, opts.json);
  try {
    const showProgress = !opts.json && !opts.markdown && !opts.dryRun;
    if (showProgress) {
      logStep(
        opts.workspace
          ? `Analyzing workspace ${colorize(opts.workspace, 'cyan')}…`
          : `Analyzing your ${colorize(String(limit), 'cyan')} most recent workspaces…`,
      );
    }

    const corpus = await gatherReflectionCorpus(limit, showProgress ? printProgress : undefined, {
      workspace: opts.workspace,
    });
    const withSessions = corpus.workspaces.filter((w) => w.session).length;
    // A script does the heavy analysis (clustering failures, counting tools,
    // spotting correction loops); the LLM only ever sees these compact facts,
    // so the judge call stays small + fast regardless of workspace count.
    const analysis = analyzeCorpus(corpus);
    const prompt = buildAnalysisPrompt(analysis);

    if (opts.dryRun) {
      // No LLM call — surface the computed facts + exactly what the judge sees.
      if (opts.json) outputJson({ analysis, prompt });
      else {
        process.stdout.write(prompt + '\n');
      }
      return;
    }

    if (withSessions === 0) {
      const msg = opts.workspace
        ? `No recent agent session found for workspace "${opts.workspace}" (need a Claude/pi transcript).`
        : 'No recent agent sessions found to analyze (need Claude/pi session transcripts).';
      if (opts.json) outputJsonError(msg);
      else logError(msg);
      process.exit(1);
    }

    // The judge shells the user's own agent and can take minutes; run it async
    // (non-blocking) so a live spinner shows it's alive, not hung. Timeout is
    // overridable for slow local models.
    const timeoutMs = Number.parseInt(process.env.NEMUS_JUDGE_TIMEOUT_MS ?? '', 10) || undefined;
    const model = opts.model ?? process.env.NEMUS_JUDGE_MODEL ?? undefined;
    const thinking = opts.thinking ?? process.env.NEMUS_JUDGE_THINKING ?? undefined;
    const stopSpinner = opts.json || opts.markdown
      ? () => {}
      : startSpinner(`Judging ${withSessions} session(s) with your configured agent (this can take a minute)…`);
    let parsed: unknown;
    try {
      parsed = await runAgentJsonAsync(prompt, { schema: REFLECT_SCHEMA, timeoutMs, model, thinking });
    } finally {
      stopSpinner();
    }
    const report = parseReflectionReport(parsed);

    // Persist the report (best-effort; never fails the run) unless --no-save.
    let savedTo: string | undefined;
    if (opts.save !== false) {
      try {
        savedTo = await saveReflectionReport(report, {
          analyzed: withSessions,
          workspaces: corpus.workspaces.length,
          workspace: opts.workspace,
        });
      } catch {
        /* saving is a convenience, not the point */
      }
    }

    if (opts.json) {
      outputJson({ analyzed: withSessions, workspaces: corpus.workspaces.length, ...report, savedTo });
      return;
    }
    if (opts.markdown) {
      // DATA channel: markdown to stdout, nothing else (a 'Saved report' note
      // would corrupt a redirected .md file), so surface the path on stderr.
      process.stdout.write(
        renderReportMarkdown(
          report,
          {
            analyzed: withSessions,
            workspaces: corpus.workspaces.length,
            workspace: opts.workspace,
            generatedAt: new Date().toISOString(),
          },
          groupBy,
        ),
      );
      if (savedTo) logInfo(`Saved report to ${colorize(savedTo, 'dim')}`);
      return;
    }
    printReport(report, corpus.workspaces.length, withSessions, groupBy);
    if (savedTo) logInfo(`Saved report to ${colorize(savedTo, 'dim')}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'reflect failed';
    if (opts.json) outputJsonError(msg);
    else {
      logError('Failed to analyze sessions');
      logError(msg);
    }
    process.exit(1);
  }
}

const KIND_LABEL: Record<Recommendation['kind'], string> = {
  skill: 'Skill',
  context: 'Context/AGENTS.md',
  test: 'Test',
  prompt: 'Prompt',
  connectivity: 'Connectivity',
  workflow: 'Workflow',
  other: 'Other',
};

/**
 * A minimal stderr spinner with elapsed seconds. Returns a stop() that clears
 * the line. No-op (single log line) when stderr isn't a TTY (piped/CI), so it
 * never pollutes captured output. Kept local + tiny — no new dependency.
 */
function startSpinner(text: string): () => void {
  if (!process.stderr.isTTY) {
    logInfo(text);
    return () => {};
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const start = Date.now();
  let i = 0;
  const render = () => {
    const secs = Math.floor((Date.now() - start) / 1000);
    process.stderr.write(`\r${colorize(frames[(i = (i + 1) % frames.length)], 'cyan')} ${text} ${colorize(`(${secs}s)`, 'dim')}`);
  };
  render();
  const timer = setInterval(render, 100);
  timer.unref?.(); // never keep the process alive on our account
  return () => {
    clearInterval(timer);
    process.stderr.write('\r' + ' '.repeat(text.length + 24) + '\r');
  };
}

/** Live per-workspace line during the gather phase (to stderr — stdout stays
 *  reserved for the report / JSON). */
function printProgress(p: ReflectProgress): void {
  const n = colorize(`${p.index + 1}/${p.total}`, 'dim');
  const d = p.digest.session;
  if (!d) {
    process.stderr.write(`  ${colorize('·', 'dim')} ${n} ${p.digest.name} ${colorize('— no session', 'dim')}\n`);
    return;
  }
  const failures = `${d.errors.length} ${d.errors.length === 1 ? 'failure' : 'failures'}`;
  const stats = colorize(`${d.turns} turns · ${d.userPrompts.length} prompts · ${failures}`, 'dim');
  process.stderr.write(`  ${colorize('✓', 'green')} ${n} ${p.digest.name}  ${stats}\n`);
}

function priorityBadge(p: Recommendation['priority']): string {
  if (p === 'high') return colorize('● high', 'red');
  if (p === 'medium') return colorize('● med', 'yellow');
  return colorize('● low', 'gray');
}

function printReport(report: ReflectionReport, workspaces: number, analyzed: number, groupBy: GroupBy = 'priority') {
  console.log('');
  console.log(colorize('  Reflection', 'bright') + colorize(`  (${analyzed} sessions across ${workspaces} workspaces)`, 'dim'));
  console.log(colorize('  ' + '─'.repeat(56), 'dim'));
  if (report.summary) {
    console.log('\n  ' + report.summary.replace(/\n/g, '\n  '));
  }

  if (report.recommendations.length === 0) {
    console.log('\n  ' + colorize('No specific recommendations — looks solid.', 'green') + '\n');
    return;
  }

  console.log('\n  ' + colorize(severitySummary(report.recommendations), 'dim'));

  for (const group of groupRecommendations(report.recommendations, groupBy)) {
    console.log('\n  ' + colorize(group.heading, 'bright'));
    for (const r of group.recs) {
      const target = r.target ? colorize(`  [${r.target}]`, 'cyan') : '';
      // Under a kind heading show the priority badge; under a priority heading
      // show the kind label (the heading conveys the other axis).
      const lead = groupBy === 'kind' ? priorityBadge(r.priority) : colorize(KIND_LABEL[r.kind], 'bright');
      console.log(`    ${lead}  ${r.title}${target}`);
      if (r.detail) console.log(`      ${r.detail.replace(/\n/g, '\n      ')}`);
      if (r.example) {
        console.log(colorize('      example:', 'dim'));
        console.log(colorize(r.example.replace(/^/gm, '        '), 'dim'));
      }
    }
  }
  console.log('');
}

async function handleHistory(opts: { json?: boolean }) {
  const reports = await listSavedReports();
  if (opts.json) {
    outputJson({
      count: reports.length,
      reports: reports.map((r) => ({
        id: r.id,
        generatedAt: r.generatedAt,
        analyzed: r.analyzed,
        workspaces: r.workspaces,
        workspace: r.workspace,
        recommendations: r.report.recommendations.length,
        severity: severitySummary(r.report.recommendations),
      })),
    });
    return;
  }
  if (reports.length === 0) {
    logInfo('No saved reflection reports yet. Run `nemus reflect` to create one.');
    return;
  }
  console.log('');
  console.log(colorize('  Saved reflections', 'bright') + colorize(`  (${reports.length})`, 'dim'));
  console.log(colorize('  ' + '─'.repeat(56), 'dim'));
  for (const r of reports) {
    const when = r.generatedAt ? new Date(r.generatedAt).toLocaleString() : r.id;
    const scope = r.workspace ? colorize(` ${r.workspace}`, 'cyan') : colorize(` ${r.analyzed} sessions`, 'dim');
    const sev = r.report.recommendations.length
      ? colorize(`  ${severitySummary(r.report.recommendations)}`, 'dim')
      : colorize('  no recs', 'green');
    console.log(`  ${colorize(r.id, 'bright')}${scope}${sev}`);
    console.log(colorize(`     ${when}`, 'dim'));
  }
  console.log('');
  console.log(colorize('  nemus reflect show <id>   (or `latest`)', 'dim'));
}

async function handleShow(
  id: string | undefined,
  opts: { json?: boolean; markdown?: boolean; groupBy?: string },
) {
  const groupBy = resolveGroupBy(opts.groupBy, opts.json);
  const matches = findSavedMatches(await listSavedReports(), id);
  const saved = matches[0];
  if (!saved) {
    const msg = id && id !== 'latest'
      ? `No saved report matching "${id}". Run "nemus reflect history" to list them.`
      : 'No saved reflection reports yet. Run "nemus reflect" to create one.';
    if (opts.json) outputJsonError(msg);
    else logError(msg);
    process.exit(1);
  }
  // An id-prefix that matches several reports resolves to the newest — say so
  // (stderr only, so --json/--markdown stdout stays clean) rather than quietly
  // showing a possibly-unintended report. An exact id / "latest" never multi-matches.
  if (matches.length > 1 && !opts.json) {
    logWarning(
      `"${id}" matched ${matches.length} reports; showing the newest (${saved.id}). Use a longer id to disambiguate.`,
    );
  }
  const meta = {
    analyzed: saved.analyzed,
    workspaces: saved.workspaces,
    workspace: saved.workspace,
    generatedAt: saved.generatedAt,
  };
  if (opts.json) {
    outputJson({ id: saved.id, ...meta, ...saved.report });
    return;
  }
  if (opts.markdown) {
    process.stdout.write(renderReportMarkdown(saved.report, meta, groupBy));
    return;
  }
  printReport(saved.report, saved.workspaces, saved.analyzed, groupBy);
}
