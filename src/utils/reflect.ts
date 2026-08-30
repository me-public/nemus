import * as fs from 'fs/promises';
import * as path from 'path';
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
  /** Error/failure snippets from tool results (missing skills/tests show up here). */
  errors: string[];
  /** Distinct tool names the agent used. */
  tools: string[];
}

export interface WorkspaceDigest {
  name: string;
  repoCount: number;
  repos: string[];
  /** Context files present at the workspace root, e.g. ['AGENTS.md']. */
  contextFiles: string[];
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

// --------------------------------------------------------- transcript distill

const MAX_PROMPTS = 25;
const MAX_ERRORS = 25;
const PROMPT_CHARS = 600;
const ERROR_CHARS = 300;

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
        if (text && !text.startsWith('<') && userPrompts.length < MAX_PROMPTS) {
          userPrompts.push(text.slice(0, PROMPT_CHARS));
        }
      }
    }
  }

  return { sessionId: meta.sessionId, agentType: meta.agentType, turns, userPrompts, errors, tools: [...tools] };
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

async function contextFilesFor(workspacePath: string): Promise<string[]> {
  const present: string[] = [];
  for (const name of getAllKnownContextFileNames()) {
    try {
      await fs.access(path.join(workspacePath, name));
      present.push(name);
    } catch {
      /* not present */
    }
  }
  return present;
}

/**
 * Build the corpus the judge reasons over: the `limit` most **recently active**
 * workspaces (by their latest agent session, not creation date — a retrospective
 * is about recent *work*), each with its repos, context files, and distilled
 * session, plus the globally-available skills.
 */
export async function gatherReflectionCorpus(limit: number): Promise<ReflectionCorpus> {
  const [sessions, workspaces, availableSkills] = await Promise.all([
    getWorkspaceSessions(), // already sorted by last-active, one per workspace
    listWorkspaces(false),
    listAvailableSkills(),
  ]);
  const metaByName = new Map(workspaces.map((w) => [w.name, w]));
  const recent = sessions.slice(0, limit);

  const digests: WorkspaceDigest[] = [];
  for (const s of recent) {
    const meta = metaByName.get(s.workspaceName);
    digests.push({
      name: s.workspaceName,
      repoCount: meta?.metadata?.repositories?.length ?? 0,
      repos: (meta?.metadata?.repositories ?? []).map((r) => r.name),
      contextFiles: await contextFilesFor(s.workspacePath),
      session: await readDigestForSession(s),
    });
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

/**
 * Build the LLM-as-a-judge prompt. The judge sees distilled recent sessions and
 * is asked to recommend concrete improvements to the user's SETUP (skills,
 * AGENTS.md/context rules, connectivity/tests, prompt habits, workflow) — not to
 * redo the tasks. Output is strict JSON matching REFLECT_SCHEMA.
 */
export function buildJudgePrompt(corpus: ReflectionCorpus): string {
  const lines: string[] = [];
  lines.push(
    'You are an expert reviewer ("LLM as a judge") analyzing an engineer\'s recent AI coding-agent sessions.',
    'Goal: recommend concrete improvements to their SETUP so the agent works better next time —',
    'which skills to add and WHERE, which AGENTS.md/context rules are missing, missing connectivity/',
    'smoke tests, and prompt habits to change. Judge the setup, do NOT redo the tasks.',
    '',
    'Base every recommendation on evidence in the sessions below (repeated failures, retries, vague',
    'prompts, missing context). Prefer a few high-signal, actionable items over many generic ones.',
    'When you suggest a skill or an AGENTS.md rule, include a short concrete `example` snippet.',
    '',
    `Globally installed skills (don't re-suggest these; suggest genuinely missing ones): ${corpus.availableSkills.join(', ') || '(none)'}`,
    '',
    `Recent workspaces (${corpus.workspaces.length}):`,
  );

  for (const ws of corpus.workspaces) {
    lines.push(`\n## ${ws.name}`);
    lines.push(`repos: ${ws.repos.join(', ') || '(none)'} | context files: ${ws.contextFiles.join(', ') || 'NONE'}`);
    if (!ws.session) {
      lines.push('session: (no recent agent session found)');
      continue;
    }
    lines.push(`session: ${ws.session.turns} turns, tools used: ${ws.session.tools.join(', ') || '(none)'}`);
    if (ws.session.userPrompts.length) {
      lines.push('user prompts:');
      for (const p of ws.session.userPrompts) lines.push(`  - ${p.replace(/\n/g, ' ')}`);
    }
    if (ws.session.errors.length) {
      lines.push('errors/failures observed:');
      for (const e of ws.session.errors) lines.push(`  - ${e.replace(/\n/g, ' ')}`);
    }
  }

  lines.push(
    '',
    'Respond with ONLY a JSON object of this shape (no prose, no markdown fence):',
    '{"summary": string, "recommendations": [{"kind":"skill|context|test|prompt|connectivity|workflow|other",',
    '"title": string, "detail": string, "target": string(optional workspace/repo/path),',
    '"priority":"high|medium|low", "example": string(optional snippet)}]}',
  );
  return lines.join('\n');
}

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
