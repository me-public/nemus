import * as fs from 'fs/promises';
import * as path from 'path';
import { CACHE_DIR } from './config';
import { listWorkspaces } from './workspace-meta';
import { getAgentPaths, getSkillsTargetDirs, getAllKnownContextFileNames, ConcreteAgentType } from './agent-config';
import { pathToProjectDirName, getWorkspaceSessions, WorkspaceSession } from './claude-sessions';

// ------------------------------------------------------------------ types

export interface SessionDigest {
  sessionId: string;
  agentType: string;
  /** Number of assistant turns (a rough measure of how much back-and-forth). */
  turns: number;
  /** Human prompts the user sent (the raw material for judging prompt quality). */
  userPrompts: string[];
  /** Verbatim user “re-steer” messages (corrections/redirects) — the highest-
   *  signal quotes for the judge to coach on. Subset of userPrompts, bounded. */
  reSteerSamples: string[];
  /** Error/failure snippets from tool results (missing skills/tests show up here). */
  errors: string[];
  /** Distinct tool names the agent used. */
  tools: string[];
}

/** How useful a workspace's context file (AGENTS.md/CLAUDE.md) actually is. */
export type ContextQuality = 'missing' | 'boilerplate' | 'substantive';

export interface WorkspaceDigest {
  name: string;
  repoCount: number;
  repos: string[];
  /** Context files present at the workspace root, e.g. ['AGENTS.md']. */
  contextFiles: string[];
  /** Whether the primary context file is missing / boilerplate / substantive. */
  contextQuality: ContextQuality;
  session: SessionDigest | null;
}

export interface ReflectionCorpus {
  generatedAt: string;
  /** Skills already installed globally (so the judge suggests real gaps). */
  availableSkills: string[];
  workspaces: WorkspaceDigest[];
}

export type RecommendationKind =
  | 'skill' | 'context' | 'test' | 'prompt' | 'connectivity' | 'workflow' | 'other';

export interface Recommendation {
  kind: RecommendationKind;
  title: string;
  detail: string;
  /** Where it applies — a workspace, repo, or path (optional). */
  target?: string;
  priority: 'high' | 'medium' | 'low';
  /** A concrete snippet (skill stub, AGENTS.md rule, test idea). */
  example?: string;
}

export interface ReflectionReport {
  summary: string;
  recommendations: Recommendation[];
}

// ------------------------------------------------------------ report rendering

export type Priority = Recommendation['priority'];

/** Count recommendations by priority. */
export function severityCounts(recs: Recommendation[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { high: 0, medium: 0, low: 0 };
  for (const r of recs) counts[r.priority]++;
  return counts;
}

/** "3 high · 2 medium · 1 low", omitting zero buckets; '' when there are none. */
export function severitySummary(recs: Recommendation[]): string {
  const c = severityCounts(recs);
  return (['high', 'medium', 'low'] as Priority[])
    .filter((p) => c[p] > 0)
    .map((p) => `${c[p]} ${p}`)
    .join(' · ');
}

const MD_KIND_LABEL: Record<RecommendationKind, string> = {
  skill: 'Skill',
  context: 'Context/AGENTS.md',
  test: 'Test',
  prompt: 'Prompt',
  connectivity: 'Connectivity',
  workflow: 'Workflow',
  other: 'Other',
};

const PRIORITY_HEADING: Record<Priority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

/** A fenced code block whose fence is guaranteed longer than any backtick run
 *  inside `body`, so the snippet can't break out of its own fence. */
function fencedBlock(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}`;
}

/**
 * Render a reflection report as clean Markdown — for pasting into an issue/PR or
 * saving alongside the JSON. Pure (no color, no I/O) so it's unit-tested.
 * Recommendations are grouped by severity (high→low); each carries its kind,
 * optional target, detail, and a fenced example.
 */
export function renderReportMarkdown(
  report: ReflectionReport,
  meta: { analyzed: number; workspaces: number; workspace?: string; generatedAt?: string },
): string {
  const lines: string[] = ['# Reflection', ''];
  const scope = meta.workspace
    ? `workspace **${meta.workspace}**`
    : `${meta.analyzed} session${meta.analyzed === 1 ? '' : 's'} across ${meta.workspaces} workspace${meta.workspaces === 1 ? '' : 's'}`;
  const stamp = meta.generatedAt ? ` · ${meta.generatedAt}` : '';
  lines.push(`_${scope}${stamp}_`, '');

  if (report.summary.trim()) lines.push(report.summary.trim(), '');

  if (report.recommendations.length === 0) {
    lines.push('## Recommendations', '', '_No specific recommendations — looks solid._', '');
    return lines.join('\n');
  }

  lines.push('## Recommendations', '', `**${severitySummary(report.recommendations)}**`, '');

  for (const priority of ['high', 'medium', 'low'] as Priority[]) {
    const group = report.recommendations.filter((r) => r.priority === priority);
    if (group.length === 0) continue;
    lines.push(`### ${PRIORITY_HEADING[priority]}`, '');
    for (const r of group) {
      const target = r.target ? ` (\`${r.target}\`)` : '';
      lines.push(`- **[${MD_KIND_LABEL[r.kind]}] ${r.title}**${target}`);
      if (r.detail.trim()) {
        lines.push(...r.detail.trim().split('\n').map((l) => `  ${l}`));
      }
      if (r.example?.trim()) {
        lines.push('', ...fencedBlock(r.example.trim()).split('\n').map((l) => `  ${l}`));
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// --------------------------------------------------------- transcript distill

// Kept deliberately lean: the judge runs on the user's own (often local, slow)
// agent, and a 10-workspace corpus at full verbosity produced a ~200KB prompt
// that timed pi out. These bounds capture the pattern of a session at a
// fraction of the tokens (~halving the prompt), so the judge actually finishes.
const MAX_PROMPTS = 12;
const MAX_ERRORS = 15;
const MAX_RESTEER = 6;
const PROMPT_CHARS = 400;
const ERROR_CHARS = 200;
const RESTEER_CHARS = 240;

// A conservative “the user corrected / redirected the agent” cue. Soft signal:
// used to count re-steers and to capture the verbatim message for the judge.
const CORRECTION_RE =
  /\b(no|nope|wrong|incorrect|revert|undo|instead|actually|you (missed|forgot|broke|didn'?t)|that'?s? (wrong|not right|incorrect)|not what|don'?t)\b/i;

/** Whether a single user prompt reads like a correction/redirect. Exported +
 *  shared with the analyzer so the two never diverge. */
export function isCorrectionPrompt(prompt: string): boolean {
  return CORRECTION_RE.test(prompt ?? '');
}

/** Flatten a message `content` (string or content-block array) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Only used as a FALLBACK when a tool result carries no explicit error flag.
// Kept to strong failure signals so a successful grep/log line for the word
// "error", or a passing test named “…error…”, isn't mistaken for a failure.
const ERROR_RE = /\b(fatal|failed|failure|exception|traceback|denied|not a git repository|timed out|exit code\s+[1-9])\b/i;

/**
 * Decide whether a tool result is a failure: trust the explicit `isError` flag
 * when present (true => failure, false => success), and only guess from the
 * text when there's no flag at all. This keeps the judge's “evidence” to real
 * failures instead of any output that happens to contain the word “error”.
 */
function isToolFailure(flag: unknown, text: string): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return ERROR_RE.test(text);
}

/**
 * Distill a raw `.jsonl` transcript into the signals a judge needs: the human
 * prompts, tool failures, and which tools ran. Pure (operates on file content),
 * defensive about the several line shapes Claude/pi emit, and bounded so a huge
 * transcript can't blow the prompt budget.
 */
export function distillTranscript(
  raw: string,
  meta: { sessionId: string; agentType: string },
): SessionDigest {
  const userPrompts: string[] = [];
  const reSteerSamples: string[] = [];
  const errors: string[] = [];
  const tools = new Set<string>();
  let turns = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const msg = obj.message ?? obj;
    const role = msg?.role ?? obj?.type;
    const content = msg?.content;

    // Assistant turn + tool uses. Claude uses `tool_use` blocks; pi uses `toolCall`.
    if (role === 'assistant') {
      turns++;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && (b.type === 'tool_use' || b.type === 'toolCall') && typeof b.name === 'string') tools.add(b.name);
        }
      }
    }

    // Tool results, two shapes:
    //  - pi: a top-level message with role 'toolResult' (+ toolName, content).
    //  - Claude: a `tool_result` block inside a user message's content array.
    if (role === 'toolResult') {
      if (typeof msg.toolName === 'string') tools.add(msg.toolName);
      const text = contentToText(content);
      if (isToolFailure(msg.isError ?? msg.is_error, text) && text.trim() && errors.length < MAX_ERRORS) {
        errors.push(text.trim().slice(0, ERROR_CHARS));
      }
    }
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === 'tool_result') {
          const text = contentToText(b.content);
          if (isToolFailure(b.is_error, text) && text.trim() && errors.length < MAX_ERRORS) {
            errors.push(text.trim().slice(0, ERROR_CHARS));
          }
        }
      }
    }

    // Human prompts: a user message that carries actual text (not a tool_result echo).
    if (role === 'user') {
      const isToolResultOnly =
        Array.isArray(content) && content.length > 0 && content.every((b: any) => b?.type === 'tool_result');
      if (!isToolResultOnly) {
        const text = contentToText(content).trim();
        if (text && !text.startsWith('<')) {
          if (userPrompts.length < MAX_PROMPTS) userPrompts.push(text.slice(0, PROMPT_CHARS));
          // Capture corrections verbatim (bounded) — the sharpest coaching signal.
          if (reSteerSamples.length < MAX_RESTEER && isCorrectionPrompt(text)) {
            reSteerSamples.push(text.slice(0, RESTEER_CHARS));
          }
        }
      }
    }
  }

  return { sessionId: meta.sessionId, agentType: meta.agentType, turns, userPrompts, reSteerSamples, errors, tools: [...tools] };
}

// ------------------------------------------------------- context classification

// Lines that are structural/boilerplate rather than real, custom guidance.
const BOILERPLATE_MARKERS = [
  'ws-rules:',
  'this workspace was created with',
  'workspace manager',
  'saved context',
  'add your own notes here',
  'common workflows',
];

/**
 * Classify an AGENTS.md/CLAUDE.md by how much *real* guidance it carries, so the
 * judge can tell “no context” from “has a file but it's the generated template.”
 * Heuristic + pure.
 *
 * Deliberately **newline-independent**: it measures the volume of non-boilerplate
 * prose (word count) plus heading count via a whitespace-tolerant regex, rather
 * than splitting on lines. A line-anchored version would misclassify any excerpt
 * whose newlines were collapsed to spaces upstream (a real bug class caught in a
 * sibling implementation) — here even a fully single-lined file classifies the
 * same as its multi-line original.
 */
export function classifyAgentsMd(content: string | null | undefined): ContextQuality {
  if (!content || !content.trim()) return 'missing';
  let s = content.replace(/\r\n/g, '\n').toLowerCase();
  s = s.replace(/```[\s\S]*?```/g, ' '); // drop fenced code
  s = s.replace(/<!--[\s\S]*?-->/g, ' '); // drop HTML comments
  for (const m of BOILERPLATE_MARKERS) s = s.split(m).join(' '); // drop generated boilerplate (markers are lowercase)
  // Headings: a `#` run at start OR after any whitespace (so a collapsed,
  // single-line excerpt still counts them), followed by a space.
  const headings = (s.match(/(?:^|\s)#{1,6}\s/g) || []).length;
  // Remaining non-boilerplate words (markdown punctuation stripped).
  const words = s.replace(/[#|>*_`~-]/g, ' ').split(/\s+/).filter((w) => w.length > 1).length;
  if (words < 40) return 'boilerplate';
  return headings >= 2 || words >= 60 ? 'substantive' : 'boilerplate';
}

// --------------------------------------------------------- corpus gathering

/** Locate the most recent `.jsonl` transcript for a workspace under an agent. */
export async function findLatestTranscriptFile(
  sessionProjectsDir: string,
  workspacePath: string,
  agentType: ConcreteAgentType,
): Promise<string | null> {
  if (agentType !== 'claude' && agentType !== 'pi') return null;
  const projDir = path.join(sessionProjectsDir, pathToProjectDirName(workspacePath, agentType));
  let entries: string[];
  try {
    entries = await fs.readdir(projDir);
  } catch {
    return null;
  }
  const jsonl = entries.filter((f) => f.endsWith('.jsonl'));
  if (jsonl.length === 0) return null;
  const stats = await Promise.all(
    jsonl.map(async (f) => {
      try {
        return { f, mtime: (await fs.stat(path.join(projDir, f))).mtime.getTime() };
      } catch {
        return null;
      }
    }),
  );
  const best = stats.filter((s): s is { f: string; mtime: number } => !!s).sort((a, b) => b.mtime - a.mtime)[0];
  return best ? path.join(projDir, best.f) : null;
}

const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

/** Read + distill the transcript for a specific discovered session. Prefers the
 *  exact `<sessionId>.jsonl`; falls back to the latest transcript in that
 *  project dir if the exact file has been rotated away. */
async function readDigestForSession(s: WorkspaceSession): Promise<SessionDigest | null> {
  if (s.agentType !== 'claude' && s.agentType !== 'pi') return null;
  const projectsDir = getAgentPaths(s.agentType).sessionProjectsDir;
  const exact = path.join(projectsDir, pathToProjectDirName(s.workspacePath, s.agentType), `${s.sessionId}.jsonl`);
  let file: string | null = exact;
  try {
    await fs.access(exact);
  } catch {
    file = await findLatestTranscriptFile(projectsDir, s.workspacePath, s.agentType);
  }
  if (!file) return null;
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    return null;
  }
  if (raw.length > MAX_TRANSCRIPT_BYTES) raw = raw.slice(raw.length - MAX_TRANSCRIPT_BYTES); // keep the tail (most recent)
  return distillTranscript(raw, { sessionId: s.sessionId, agentType: s.agentType });
}

async function listAvailableSkills(): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of getSkillsTargetDirs()) {
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name);
        else if (entry.name.endsWith('.md')) names.add(entry.name.replace(/\.md$/, ''));
      }
    } catch {
      /* dir may not exist */
    }
  }
  return [...names].sort();
}

/** Which context files exist at the workspace root, plus how substantive the
 *  primary one is (missing/boilerplate/substantive). One read per present file. */
async function contextFilesFor(workspacePath: string): Promise<{ files: string[]; quality: ContextQuality }> {
  const present: string[] = [];
  let quality: ContextQuality = 'missing';
  for (const name of getAllKnownContextFileNames()) {
    try {
      const content = await fs.readFile(path.join(workspacePath, name), 'utf-8');
      present.push(name);
      // Classify the first present file, then keep the best classification seen.
      const c = classifyAgentsMd(content);
      if (quality === 'missing' || (quality === 'boilerplate' && c === 'substantive')) quality = c;
    } catch {
      /* not present / unreadable */
    }
  }
  return { files: present, quality };
}

/** Fired as each workspace is read + distilled, so the CLI can show live,
 *  per-workspace progress during the (I/O-bound) gather phase. */
export interface ReflectProgress {
  index: number;
  total: number;
  digest: WorkspaceDigest;
}

/**
 * Build the corpus the judge reasons over: the `limit` most **recently active**
 * workspaces (by their latest agent session, not creation date — a retrospective
 * is about recent *work*), each with its repos, context files, and distilled
 * session, plus the globally-available skills. `onProgress` (optional) fires
 * once per workspace as it finishes, for a live progress display.
 */
export async function gatherReflectionCorpus(
  limit: number,
  onProgress?: (p: ReflectProgress) => void,
  opts: { workspace?: string } = {},
): Promise<ReflectionCorpus> {
  const [sessions, workspaces, availableSkills] = await Promise.all([
    getWorkspaceSessions(), // already sorted by last-active, one per workspace
    listWorkspaces(false),
    listAvailableSkills(),
  ]);
  const metaByName = new Map(workspaces.map((w) => [w.name, w]));
  // A single named workspace (ignores limit), else the N most recently active.
  const recent = opts.workspace
    ? sessions.filter((s) => s.workspaceName === opts.workspace)
    : sessions.slice(0, limit);

  const digests: WorkspaceDigest[] = [];
  for (let index = 0; index < recent.length; index++) {
    const s = recent[index];
    const meta = metaByName.get(s.workspaceName);
    const context = await contextFilesFor(s.workspacePath);
    const digest: WorkspaceDigest = {
      name: s.workspaceName,
      repoCount: meta?.metadata?.repositories?.length ?? 0,
      repos: (meta?.metadata?.repositories ?? []).map((r) => r.name),
      contextFiles: context.files,
      contextQuality: context.quality,
      session: await readDigestForSession(s),
    };
    digests.push(digest);
    onProgress?.({ index, total: recent.length, digest });
  }

  return { generatedAt: new Date().toISOString(), availableSkills, workspaces: digests };
}

// ------------------------------------------------------------- judge prompt

/** JSON schema for `claude --json-schema` (best-effort; other agents ignore it). */
export const REFLECT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['skill', 'context', 'test', 'prompt', 'connectivity', 'workflow', 'other'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          target: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          example: { type: 'string' },
        },
        required: ['kind', 'title', 'detail', 'priority'],
      },
    },
  },
  required: ['summary', 'recommendations'],
});

// The judge prompt is now built from pre-computed FACTS (see reflect-analyze.ts
// `buildAnalysisPrompt`), not raw transcripts, so the LLM call stays small/fast.

// ----------------------------------------------------------- response parse

const KINDS: RecommendationKind[] = ['skill', 'context', 'test', 'prompt', 'connectivity', 'workflow', 'other'];
const PRIORITIES = ['high', 'medium', 'low'] as const;

/** Validate + normalize the judge's parsed JSON into a ReflectionReport. */
export function parseReflectionReport(parsed: unknown): ReflectionReport {
  const obj = (parsed ?? {}) as any;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const rawRecs = Array.isArray(obj.recommendations) ? obj.recommendations : [];
  const recommendations: Recommendation[] = rawRecs
    .map((r: any): Recommendation | null => {
      if (!r || typeof r !== 'object') return null;
      const title = typeof r.title === 'string' ? r.title : '';
      const detail = typeof r.detail === 'string' ? r.detail : '';
      if (!title && !detail) return null;
      const kind: RecommendationKind = KINDS.includes(r.kind) ? r.kind : 'other';
      const priority = PRIORITIES.includes(r.priority) ? r.priority : 'medium';
      const rec: Recommendation = { kind, title, detail, priority };
      if (typeof r.target === 'string' && r.target.trim()) rec.target = r.target.trim();
      if (typeof r.example === 'string' && r.example.trim()) rec.example = r.example.trim();
      return rec;
    })
    .filter((r: Recommendation | null): r is Recommendation => r !== null);
  return { summary, recommendations };
}

// -------------------------------------------------------------- report saving

/** Where saved reflection reports live: `~/.nemus/reflect/`. */
export const REFLECT_REPORTS_DIR = path.join(CACHE_DIR, 'reflect');

/**
 * Persist a reflection report as timestamped JSON under `~/.nemus/reflect/`, so
 * a run can be revisited or diffed over time. Returns the written path. Pure
 * side-effect (mkdir -p + write); callers treat failure as non-fatal.
 */
export async function saveReflectionReport(
  report: ReflectionReport,
  meta: { analyzed: number; workspaces: number; workspace?: string },
): Promise<string> {
  await fs.mkdir(REFLECT_REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scope = meta.workspace ? `-${meta.workspace.replace(/[^a-zA-Z0-9_-]+/g, '_')}` : '';
  const file = path.join(REFLECT_REPORTS_DIR, `${stamp}${scope}.json`);
  await fs.writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), ...meta, ...report }, null, 2));
  return file;
}
