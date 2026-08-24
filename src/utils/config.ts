import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const HOME_DIR = os.homedir();

// Config file lives outside CACHE_DIR so we can read it to determine CACHE_DIR
const CONFIG_FILE = path.join(HOME_DIR, '.workspace-manager-cache', 'config.json');

/** Coding-agent CLIs Nemus can integrate with. */
export type ConcreteAgentType = 'claude' | 'pi' | 'opencode' | 'codex' | 'gemini';
export type AgentType = ConcreteAgentType | 'both' | 'auto';
export type PrimaryAgentType = ConcreteAgentType | 'auto';

export interface UserConfig {
  workspacesDir: string;
  githubOrg: string;
  autoLaunchClaude: boolean;
  generateClaudeContext: boolean;
  cloneProtocol: 'ssh' | 'https';
  installMcp: boolean;
  /** Which AI agent(s) to integrate with: 'claude', 'pi', 'both', or 'auto' (detect from installed CLIs) */
  aiAgent: AgentType;
  /** Which agent to launch when opening workspaces: 'claude', 'pi', or 'auto' (first available) */
  primaryAgent: PrimaryAgentType;
  /** Show workspace status widget in Pi's input area (branch, PRs, CI). Pi only. */
  piWorkspaceInputStatus: boolean;
  /** Show workspace repo table in Claude Code's status line. Claude only. */
  claudeWorkspaceStatusLine: boolean;
  /** Automatically file a GitHub issue when a command crashes (deduped, sanitized). */
  autoReportBugs: boolean;
}

const DEFAULTS: UserConfig = {
  workspacesDir: path.join(HOME_DIR, 'workspaces'),
  githubOrg: '',
  autoLaunchClaude: true,
  generateClaudeContext: true,
  cloneProtocol: 'ssh',
  installMcp: true,
  aiAgent: 'auto',
  primaryAgent: 'auto',
  piWorkspaceInputStatus: true,
  claudeWorkspaceStatusLine: true,
  autoReportBugs: false,
};

function loadConfigFileSync(): Partial<UserConfig> {
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const raw = JSON.parse(content);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

    const result: Partial<UserConfig> = {};
    if (typeof raw.workspacesDir === 'string' && raw.workspacesDir) result.workspacesDir = raw.workspacesDir;
    if (typeof raw.githubOrg === 'string' && raw.githubOrg) result.githubOrg = raw.githubOrg;
    if (typeof raw.autoLaunchClaude === 'boolean') result.autoLaunchClaude = raw.autoLaunchClaude;
    if (typeof raw.generateClaudeContext === 'boolean') result.generateClaudeContext = raw.generateClaudeContext;
    if (raw.cloneProtocol === 'ssh' || raw.cloneProtocol === 'https') result.cloneProtocol = raw.cloneProtocol;
    if (typeof raw.installMcp === 'boolean') result.installMcp = raw.installMcp;
    const agentValues = ['claude', 'pi', 'opencode', 'codex', 'gemini'];
    if (agentValues.includes(raw.aiAgent) || raw.aiAgent === 'both' || raw.aiAgent === 'auto') result.aiAgent = raw.aiAgent;
    if (agentValues.includes(raw.primaryAgent) || raw.primaryAgent === 'auto') result.primaryAgent = raw.primaryAgent;
    if (typeof raw.piWorkspaceInputStatus === 'boolean') result.piWorkspaceInputStatus = raw.piWorkspaceInputStatus;
    if (typeof raw.claudeWorkspaceStatusLine === 'boolean') result.claudeWorkspaceStatusLine = raw.claudeWorkspaceStatusLine;
    if (typeof raw.autoReportBugs === 'boolean') result.autoReportBugs = raw.autoReportBugs;
    return result;
  } catch {
    return {};
  }
}

/** Get the full resolved user config (defaults + file overrides). Always reads from disk. */
export function getUserConfig(): UserConfig {
  return { ...DEFAULTS, ...loadConfigFileSync() };
}

// Bootstrap constants from initial config read (env vars take precedence)
const initialConfig = getUserConfig();

export const WORKSPACES_DIR = process.env.WORKSPACE_MANAGER_DIR || initialConfig.workspacesDir;
export const CACHE_DIR = process.env.WORKSPACE_MANAGER_CACHE_DIR || path.join(HOME_DIR, '.workspace-manager-cache');
export const HISTORY_FILE = path.join(CACHE_DIR, 'history.jsonl');
export const SUITES_FILE = path.join(CACHE_DIR, 'suites.json');
export const META_FILENAME = '.workspace-meta.json';
export const CONFIG_PATH = CONFIG_FILE;

// ── Clone execution limits ──────────────────────────────────────────────────
// Git clone runs via child_process.exec, which (a) kills the process on
// timeout and (b) has a small default maxBuffer (1 MB) that a large repo's
// progress output can blow past. Both surface as confusing "Command failed"
// errors, so we set generous, overridable limits here.
export const CLONE_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.WORKSPACE_CLONE_TIMEOUT_MS);
  // Invalid or non-positive values (incl. 0) fall back to the 15-min default.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
})();
export const CLONE_MAX_BUFFER = 64 * 1024 * 1024; // 64 MB

export const config = {
  workspacesDir: WORKSPACES_DIR,
  cacheDir: CACHE_DIR,
  historyFile: HISTORY_FILE,
  suitesFile: SUITES_FILE,
  metaFilename: META_FILENAME,
};

/** Read the package version from package.json. */
export function getPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/** Get the clone URL for a repo based on the configured protocol. */
export function getCloneUrl(repo: { url: string; sshUrl: string }): string {
  const { cloneProtocol } = getUserConfig();
  if (cloneProtocol === 'https') {
    return repo.url.endsWith('.git') ? repo.url : `${repo.url}.git`;
  }
  return repo.sshUrl;
}

/** Save user config to disk. */
export function saveUserConfig(cfg: UserConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}
