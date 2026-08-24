import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { getUserConfig, AgentType, PrimaryAgentType, ConcreteAgentType } from './config';

// Re-export for convenience
export { AgentType, PrimaryAgentType, ConcreteAgentType } from './config';

export interface AgentPaths {
  /** Agent identifier */
  type: ConcreteAgentType;
  /** Directory for skills (e.g. ~/.claude/skills or ~/.pi/agent/skills) */
  skillsDir: string;
  /** Settings file (e.g. ~/.claude/settings.json or ~/.pi/agent/settings.json) */
  settingsFile: string;
  /** Context file name generated in workspaces (e.g. CLAUDE.md or AGENTS.md) */
  contextFileName: string;
  /** CLI command to launch the agent */
  launchCommand: string;
  /** CLI command to resume a session */
  resumeCommand: (sessionId: string) => string;
  /** Whether this agent supports MCP (Model Context Protocol) */
  supportsMcp: boolean;
  /** Whether this agent supports hooks in settings.json (Claude Code format) */
  supportsHooks: boolean;
  /** Session projects directory (for session discovery) */
  sessionProjectsDir: string;
}

const HOME = os.homedir();

/**
 * Detection order for `auto` / `both` / `getPrimaryAgent`. Also the order agents
 * appear in `getActiveAgents()`. Add a new agent's config below and to this list.
 */
export const AGENT_ORDER: ConcreteAgentType[] = ['claude', 'pi', 'opencode', 'codex', 'gemini'];

const CLAUDE_PATHS: AgentPaths = {
  type: 'claude',
  skillsDir: path.join(HOME, '.claude', 'skills'),
  settingsFile: path.join(HOME, '.claude', 'settings.json'),
  // Must be exactly 'CLAUDE.md': Claude Code only auto-discovers CLAUDE.md /
  // AGENTS.md up the cwd/ancestor chain. A hidden lowercase '.claude.md' is
  // invisible to its project-memory loader, so the workspace context (and its
  // 'Saved Context' pointer) would never surface automatically (issue #186).
  contextFileName: 'CLAUDE.md',
  launchCommand: 'claude',
  resumeCommand: (id: string) => `claude --resume ${id} --fork-session`,
  supportsMcp: true,
  supportsHooks: true,
  sessionProjectsDir: path.join(HOME, '.claude', 'projects'),
};

const PI_PATHS: AgentPaths = {
  type: 'pi',
  skillsDir: path.join(HOME, '.pi', 'agent', 'skills'),
  settingsFile: path.join(HOME, '.pi', 'agent', 'settings.json'),
  contextFileName: 'AGENTS.md',
  launchCommand: 'pi',
  resumeCommand: (id: string) => `pi --session ${id} --fork`,
  supportsMcp: false,
  supportsHooks: false,
  sessionProjectsDir: path.join(HOME, '.pi', 'agent', 'sessions'),
};

// OpenCode uses XDG paths: ~/.local/share/opencode for data, ~/.config/opencode for config
// It reads skills from ~/.claude/skills/ automatically (Claude-compatible)
// Project config lives in .opencode/ within the project directory
const OPENCODE_DATA_DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'opencode');
const OPENCODE_CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'opencode');

const OPENCODE_PATHS: AgentPaths = {
  type: 'opencode',
  // OpenCode reads skills from ~/.claude/skills/ natively — no separate install needed
  skillsDir: path.join(HOME, '.claude', 'skills'),
  settingsFile: path.join(OPENCODE_CONFIG_DIR, 'opencode.jsonc'),
  contextFileName: 'AGENTS.md',
  launchCommand: 'opencode',
  resumeCommand: (_id: string) => `opencode --continue`,
  supportsMcp: true,
  supportsHooks: false,
  sessionProjectsDir: OPENCODE_DATA_DIR,
};

// Codex (OpenAI Codex CLI) — config under ~/.codex, reads AGENTS.md for context,
// supports MCP servers via ~/.codex/config.toml. No native skills or hooks.
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const CODEX_PATHS: AgentPaths = {
  type: 'codex',
  skillsDir: path.join(CODEX_HOME, 'skills'),
  settingsFile: path.join(CODEX_HOME, 'config.toml'),
  contextFileName: 'AGENTS.md',
  launchCommand: 'codex',
  resumeCommand: (id: string) => `codex resume ${id}`,
  supportsMcp: true,
  supportsHooks: false,
  sessionProjectsDir: path.join(CODEX_HOME, 'sessions'),
};

// Gemini (Google Gemini CLI) — config under ~/.gemini, reads GEMINI.md for
// context, supports MCP servers via ~/.gemini/settings.json. No hooks.
const GEMINI_HOME = path.join(HOME, '.gemini');
const GEMINI_PATHS: AgentPaths = {
  type: 'gemini',
  skillsDir: path.join(GEMINI_HOME, 'skills'),
  settingsFile: path.join(GEMINI_HOME, 'settings.json'),
  contextFileName: 'GEMINI.md',
  launchCommand: 'gemini',
  resumeCommand: (_id: string) => `gemini`,
  supportsMcp: true,
  supportsHooks: false,
  sessionProjectsDir: path.join(GEMINI_HOME, 'tmp'),
};

const AGENT_REGISTRY: Record<ConcreteAgentType, AgentPaths> = {
  claude: CLAUDE_PATHS,
  pi: PI_PATHS,
  opencode: OPENCODE_PATHS,
  codex: CODEX_PATHS,
  gemini: GEMINI_PATHS,
};

/**
 * Get AgentPaths for a specific agent type.
 */
export function getAgentPaths(agent: ConcreteAgentType): AgentPaths {
  return { ...AGENT_REGISTRY[agent] };
}

/**
 * Resolve 'auto' to a concrete agent type by detecting installed CLIs.
 * Cached after first call to avoid repeated shell exec.
 */
let resolvedAutoAgent: ConcreteAgentType | 'both' | null = null;

function resolveAutoAgent(): ConcreteAgentType | 'both' {
  if (resolvedAutoAgent) return resolvedAutoAgent;

  const available = AGENT_ORDER.filter(a => isAgentCliAvailable(a));

  // If multiple agents detected, use 'both' (meaning: all available agents).
  if (available.length > 1) resolvedAutoAgent = 'both';
  else if (available.length === 1) resolvedAutoAgent = available[0];
  else resolvedAutoAgent = 'claude'; // default to claude even if not installed

  return resolvedAutoAgent;
}

/**
 * Get all active agent configurations based on user config.
 * Resolves 'auto' by detecting installed CLIs. 'both' means every available agent.
 */
export function getActiveAgents(): AgentPaths[] {
  let { aiAgent } = getUserConfig();
  if (aiAgent === 'auto') aiAgent = resolveAutoAgent();

  if (aiAgent === 'both') {
    const agents = AGENT_ORDER.filter(a => isAgentCliAvailable(a)).map(a => ({ ...AGENT_REGISTRY[a] }));
    // Fallback to Claude if nothing detected (shouldn't happen in 'both' mode)
    return agents.length > 0 ? agents : [{ ...CLAUDE_PATHS }];
  }

  return [{ ...AGENT_REGISTRY[aiAgent] }];
}

/**
 * Get the preferred (primary) agent — the one used for launching, dashboards, etc.
 * Uses the `primaryAgent` config. When 'auto', picks the first available CLI.
 */
export function getPrimaryAgent(): AgentPaths {
  const { primaryAgent } = getUserConfig();

  if (primaryAgent !== 'auto') return { ...AGENT_REGISTRY[primaryAgent] };

  // 'auto' — pick first available in detection order
  const first = AGENT_ORDER.find(a => isAgentCliAvailable(a));
  return { ...AGENT_REGISTRY[first ?? 'claude'] };
}

/**
 * Check if a specific agent CLI is available on the system.
 * Result is cached per agent to avoid repeated execSync overhead.
 */
const cliAvailabilityCache = new Map<string, boolean>();

export function isAgentCliAvailable(agent: ConcreteAgentType): boolean {
  if (cliAvailabilityCache.has(agent)) return cliAvailabilityCache.get(agent)!;

  const command = `${AGENT_REGISTRY[agent].launchCommand} --version`;
  let available: boolean;
  try {
    execSync(command, { stdio: 'pipe' });
    available = true;
  } catch {
    available = false;
  }

  cliAvailabilityCache.set(agent, available);
  return available;
}

/**
 * Reset all cached values. For use in tests to ensure clean state.
 * @internal
 */
export function resetAgentConfigCache(): void {
  resolvedAutoAgent = null;
  cliAvailabilityCache.clear();
}

/**
 * Get all skills directories that should be written to.
 */
export function getSkillsTargetDirs(): string[] {
  const dirs = getActiveAgents().map(a => a.skillsDir);
  return [...new Set(dirs)];
}

/**
 * Get all context file names that should be generated in workspaces.
 * Deduplicates if multiple agents use the same file.
 */
export function getContextFileNames(): string[] {
  const names = getActiveAgents().map(a => a.contextFileName);
  return [...new Set(names)];
}

/**
 * Get all settings files where hooks should be installed.
 * Only returns agents that support hooks.
 */
export function getHookTargetFiles(): string[] {
  return getActiveAgents()
    .filter(a => a.supportsHooks)
    .map(a => a.settingsFile);
}

/**
 * Get all agents that support MCP.
 */
export function getMcpAgents(): AgentPaths[] {
  return getActiveAgents().filter(a => a.supportsMcp);
}

/**
 * Get every context file name that any known agent can produce, regardless
 * of which agents are currently configured. Used when scanning repos for
 * existing context files (e.g. a Pi workspace may contain repos that were
 * previously set up for Claude Code, and vice-versa).
 *
 * Also includes legacy '.claude.md' — the filename generated for Claude before
 * issue #186 — so repos/workspaces that still contain one are still recognized.
 */
export function getAllKnownContextFileNames(): string[] {
  // Order matters: this is the per-repo scan PRIORITY (findContextFilesInDir
  // embeds the first existing candidate per directory). AGENTS.md must come
  // before CLAUDE.md — in dual-agent repos CLAUDE.md is commonly a thin
  // "@AGENTS.md" shim, so AGENTS.md holds the real content. '.claude.md' is the
  // legacy output (pre-#186), kept last so any lingering files are still
  // recognized.
  const priority = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude.md'];
  const fromAgents = AGENT_ORDER.map(a => AGENT_REGISTRY[a].contextFileName);
  return [...new Set([...priority, ...fromAgents])];
}
