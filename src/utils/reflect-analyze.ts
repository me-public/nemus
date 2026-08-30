import { ReflectionCorpus, ContextQuality, isCorrectionPrompt } from './reflect';

/**
 * Deterministic analysis layer for `reflect`.
 *
 * The LLM used to read raw transcripts (every prompt + every error) for every
 * workspace, which made the judge prompt large and slow (timeouts on local
 * models). Instead, a *script* does the heavy lifting here — clustering repeated
 * failures, counting tools, spotting correction/retry loops — and the LLM only
 * ever sees a small, pre-computed set of FACTS. That keeps the judge call fast
 * and bounded no matter how many workspaces are analyzed, and grounds every
 * recommendation in real counts rather than a wall of text.
 *
 * Everything here is pure (corpus in → report out) so it's exhaustively
 * unit-tested without spawning an agent.
 */

// ------------------------------------------------------------------ types

export interface ErrorCluster {
  /** Normalized signature (paths/numbers/hashes stripped) used to group. */
  signature: string;
  /** Total occurrences across all analyzed sessions. */
  count: number;
  /** Distinct workspaces the signature appeared in (recurrence = strong signal). */
  workspaces: string[];
  /** One representative raw example (bounded). */
  example: string;
}

export interface ToolStat {
  tool: string;
  /** Number of sessions that used the tool (not raw invocation count — the
   *  digest only records distinct tools per session). */
  sessions: number;
}

export interface WorkspaceFact {
  name: string;
  turns: number;
  failures: number;
  /** Whether the primary context file is missing / boilerplate / substantive. */
  contextQuality: ContextQuality;
  /** The workspace's single most frequent failure signature, if any. */
  topFailure?: string;
}

export interface AnalysisReport {
  totalWorkspaces: number;
  sessionsAnalyzed: number;
  totalTurns: number;
  /** Recurring failures, most frequent first. */
  topErrors: ErrorCluster[];
  /** Most-used tools, most sessions first. */
  topTools: ToolStat[];
  /** How many user prompts looked like corrections/retries (a friction signal). */
  correctionSignals: number;
  /** Verbatim user re-steer messages across sessions (the sharpest coaching
   *  signal), most-recent-workspace first, bounded. */
  reSteerSamples: string[];
  /** Workspaces with NO context file at all. */
  workspacesMissingContext: string[];
  /** Workspaces whose context file exists but is just boilerplate/template. */
  workspacesBoilerplateContext: string[];
  /** Skills already installed (so the judge suggests genuine gaps). */
  availableSkills: string[];
  /** One compact line of facts per workspace, for grounding. */
  workspaces: WorkspaceFact[];
}

// --------------------------------------------------------------- normalizing

/**
 * Reduce a raw error string to a stable signature so near-identical failures
 * cluster together: lowercase, drop quotes, replace filesystem paths, hashes,
 * hex ids and bare numbers with placeholders, collapse whitespace, and cap the
 * length. `"fatal: not a git repository (or any of the parent up to /Users/x)"`
 * and the same from another path collapse to one signature.
 */
export function normalizeErrorSignature(raw: string): string {
  let s = (raw ?? '').toLowerCase();
  s = s.replace(/[`'"]/g, ' ');
  // Windows paths first (contain ':' and '\'), then unix paths.
  s = s.replace(/[a-z]:\\[^\s]+/g, '<path>');
  s = s.replace(/\/[^\s:)'"]+/g, '<path>');
  // Long hex / uuids / sha-like tokens before bare numbers.
  s = s.replace(/\b[0-9a-f]{7,}\b/g, '<hash>');
  // No trailing \b, so a number glued to a unit ('4200ms', '9ms') still clusters.
  s = s.replace(/\b\d[\d.,:]*/g, '<n>');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 100);
}

// ------------------------------------------------------------------ analyze

export interface AnalyzeOptions {
  /** Max error clusters to surface (default 8). */
  topErrors?: number;
  /** Max tools to surface (default 10). */
  topTools?: number;
  /** Max chars of a raw error kept as the example (default 160). */
  exampleChars?: number;
  /** Max verbatim re-steer samples to surface to the judge (default 8). */
  maxReSteer?: number;
}

/**
 * Turn a distilled corpus into aggregated facts. This is the "script processes
 * the data" step — the LLM never sees the raw corpus, only the returned report.
 */
export function analyzeCorpus(corpus: ReflectionCorpus, opts: AnalyzeOptions = {}): AnalysisReport {
  const topErrorsK = opts.topErrors ?? 8;
  const topToolsK = opts.topTools ?? 10;
  const exampleChars = opts.exampleChars ?? 160;
  const maxReSteer = opts.maxReSteer ?? 8;

  const errorMap = new Map<string, { count: number; ws: Set<string>; example: string }>();
  const toolMap = new Map<string, number>();
  const workspacesMissingContext: string[] = [];
  const workspacesBoilerplateContext: string[] = [];
  const reSteerSamples: string[] = [];
  const workspaces: WorkspaceFact[] = [];
  let sessionsAnalyzed = 0;
  let totalTurns = 0;
  let correctionSignals = 0;

  for (const ws of corpus.workspaces) {
    if (ws.contextQuality === 'missing') workspacesMissingContext.push(ws.name);
    else if (ws.contextQuality === 'boilerplate') workspacesBoilerplateContext.push(ws.name);

    const s = ws.session;
    if (!s) {
      workspaces.push({ name: ws.name, turns: 0, failures: 0, contextQuality: ws.contextQuality });
      continue;
    }

    sessionsAnalyzed++;
    totalTurns += s.turns;
    for (const t of s.tools) toolMap.set(t, (toolMap.get(t) ?? 0) + 1);
    correctionSignals += s.userPrompts.filter(isCorrectionPrompt).length;
    for (const q of s.reSteerSamples) {
      if (reSteerSamples.length < maxReSteer) reSteerSamples.push(q);
    }

    // Per-workspace signature tally (drives the global map + this ws's topFailure).
    const localSig = new Map<string, number>();
    for (const e of s.errors) {
      const sig = normalizeErrorSignature(e);
      if (!sig) continue;
      localSig.set(sig, (localSig.get(sig) ?? 0) + 1);
      let entry = errorMap.get(sig);
      if (!entry) {
        entry = { count: 0, ws: new Set(), example: e.slice(0, exampleChars) };
        errorMap.set(sig, entry);
      }
      entry.count++;
      entry.ws.add(ws.name);
    }
    const topFailure = [...localSig.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    workspaces.push({ name: ws.name, turns: s.turns, failures: s.errors.length, contextQuality: ws.contextQuality, topFailure });
  }

  const topErrors: ErrorCluster[] = [...errorMap.entries()]
    .map(([signature, v]) => ({ signature, count: v.count, workspaces: [...v.ws], example: v.example }))
    // Most frequent first; break ties by cross-workspace spread (recurrence).
    .sort((a, b) => b.count - a.count || b.workspaces.length - a.workspaces.length)
    .slice(0, topErrorsK);

  const topTools: ToolStat[] = [...toolMap.entries()]
    .map(([tool, sessions]) => ({ tool, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.tool.localeCompare(b.tool))
    .slice(0, topToolsK);

  return {
    totalWorkspaces: corpus.workspaces.length,
    sessionsAnalyzed,
    totalTurns,
    topErrors,
    topTools,
    correctionSignals,
    reSteerSamples,
    workspacesMissingContext,
    workspacesBoilerplateContext,
    availableSkills: corpus.availableSkills,
    workspaces,
  };
}

// --------------------------------------------------------------- judge prompt

/**
 * Build the judge prompt from the pre-computed facts. Compact by construction
 * (a handful of clusters + counts), so the LLM call stays small and fast no
 * matter how many workspaces were analyzed. Output contract is unchanged
 * (REFLECT_SCHEMA), so parsing/rendering are shared with the old path.
 */
export function buildAnalysisPrompt(a: AnalysisReport): string {
  const L: string[] = [];
  L.push(
    'You are an expert reviewer ("LLM as a judge"). A script has already analyzed an engineer\'s',
    'recent AI coding-agent sessions and distilled them into the FACTS below. Do not ask for the',
    'raw transcripts — reason only from these facts.',
    '',
    'Goal: recommend concrete improvements to their SETUP so the agent works better next time —',
    'which skills to add and WHERE, which AGENTS.md/context rules are missing, missing connectivity/',
    'smoke tests, and prompt/workflow habits. Ground every recommendation in a fact below',
    '(a recurring failure, a correction loop, a missing context file). Prefer a few high-signal',
    'items over many generic ones. Include a concrete `example` snippet for skills/context rules.',
    '',
    `Sessions analyzed: ${a.sessionsAnalyzed} across ${a.totalWorkspaces} workspaces (${a.totalTurns} total turns).`,
    `Installed skills (don't re-suggest; find genuine gaps): ${a.availableSkills.join(', ') || '(none)'}`,
    `User correction/retry signals: ${a.correctionSignals} prompt(s) looked like corrections.`,
    `Workspaces with NO context file (AGENTS.md/CLAUDE.md): ${a.workspacesMissingContext.join(', ') || '(none)'}`,
    `Workspaces whose context file is just boilerplate/template: ${a.workspacesBoilerplateContext.join(', ') || '(none)'}`,
  );

  if (a.reSteerSamples.length) {
    L.push('', 'Verbatim user corrections/re-steers (the sharpest signal — quote/act on these):');
    for (const q of a.reSteerSamples) L.push(`  - “${q.replace(/\n/g, ' ')}”`);
  }

  L.push('', 'Top recurring failures (count × workspaces — example):');
  if (a.topErrors.length === 0) L.push('  (none captured)');
  for (const e of a.topErrors) {
    L.push(`  - [${e.count}× in ${e.workspaces.length} ws] ${e.signature}`);
    L.push(`      e.g. ${e.example.replace(/\n/g, ' ')}`);
  }

  L.push('', `Most-used tools: ${a.topTools.map((t) => `${t.tool}(${t.sessions})`).join(', ') || '(none)'}`);

  L.push('', 'Per-workspace:');
  for (const w of a.workspaces) {
    const top = w.topFailure ? ` · top failure: ${w.topFailure}` : '';
    L.push(`  - ${w.name}: ${w.turns} turns, ${w.failures} failures, context:${w.contextQuality}${top}`);
  }

  L.push(
    '',
    'Respond with ONLY a JSON object of this shape (no prose, no markdown fence):',
    '{"summary": string, "recommendations": [{"kind":"skill|context|test|prompt|connectivity|workflow|other",',
    '"title": string, "detail": string, "target": string(optional workspace/repo/path),',
    '"priority":"high|medium|low", "example": string(optional snippet)}]}',
  );
  return L.join('\n');
}
