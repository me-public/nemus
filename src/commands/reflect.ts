import { Command } from 'commander';
import { logError, logInfo, logStep } from '../utils/logger';
import { outputJson, outputJsonError } from '../utils/output';
import { colorize } from '../utils/colors';
import {
  gatherReflectionCorpus,
  buildJudgePrompt,
  parseReflectionReport,
  REFLECT_SCHEMA,
  ReflectionReport,
  Recommendation,
} from '../utils/reflect';
import { runAgentJson } from '../utils/agent-judge';

export function registerReflectCommand(parent: Command) {
  parent
    .command('reflect')
    .alias('retro')
    .description('Analyze your recent workspace sessions and suggest skill/prompt/context improvements (LLM-as-a-judge)')
    .option('-n, --limit <n>', 'How many recent workspaces to analyze', '10')
    .option('--json', 'Output the report as JSON')
    .option('--dry-run', 'Print the assembled corpus + judge prompt without calling the agent')
    .action(async (opts) => {
      await handleReflect(opts);
    });
}

async function handleReflect(opts: { limit?: string; json?: boolean; dryRun?: boolean }) {
  const limit = Math.max(1, Number.parseInt(opts.limit ?? '10', 10) || 10);
  try {
    if (!opts.json && !opts.dryRun) {
      logStep(`Analyzing your ${colorize(String(limit), 'cyan')} most recent workspaces…`);
      logInfo('Reading sessions and distilling prompts + failures…');
    }

    const corpus = await gatherReflectionCorpus(limit);
    const withSessions = corpus.workspaces.filter((w) => w.session).length;
    const prompt = buildJudgePrompt(corpus);

    if (opts.dryRun) {
      // No LLM call — surface exactly what the judge would see.
      if (opts.json) outputJson({ corpus, prompt });
      else {
        process.stdout.write(prompt + '\n');
      }
      return;
    }

    if (withSessions === 0) {
      const msg = 'No recent agent sessions found to analyze (need Claude/pi session transcripts).';
      if (opts.json) outputJsonError(msg);
      else logError(msg);
      process.exit(1);
    }

    if (!opts.json) logInfo(`Judging ${withSessions} session(s) with your configured agent…`);
    const parsed = runAgentJson(prompt, { schema: REFLECT_SCHEMA });
    const report = parseReflectionReport(parsed);

    if (opts.json) {
      outputJson({ analyzed: withSessions, workspaces: corpus.workspaces.length, ...report });
      return;
    }
    printReport(report, corpus.workspaces.length, withSessions);
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

function priorityBadge(p: Recommendation['priority']): string {
  if (p === 'high') return colorize('● high', 'red');
  if (p === 'medium') return colorize('● med', 'yellow');
  return colorize('● low', 'gray');
}

function printReport(report: ReflectionReport, workspaces: number, analyzed: number) {
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

  // High priority first.
  const order = { high: 0, medium: 1, low: 2 };
  const recs = [...report.recommendations].sort((a, b) => order[a.priority] - order[b.priority]);

  console.log('');
  for (const r of recs) {
    const target = r.target ? colorize(`  [${r.target}]`, 'cyan') : '';
    console.log(`  ${priorityBadge(r.priority)}  ${colorize(KIND_LABEL[r.kind], 'bright')}  ${r.title}${target}`);
    if (r.detail) console.log(`      ${r.detail.replace(/\n/g, '\n      ')}`);
    if (r.example) {
      console.log(colorize('      example:', 'dim'));
      console.log(colorize(r.example.replace(/^/gm, '        '), 'dim'));
    }
    console.log('');
  }
}
