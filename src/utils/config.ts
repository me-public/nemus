import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const HOME_DIR = os.homedir();

const LEGACY_CACHE_DIR = path.join(HOME_DIR, '.workspace-manager-cache');

// Entries in ~/.nemus that do NOT make it a "real install": regenerable caches
// and the shell-integration artifact. Anything else (config.json, suites.json,
// history.jsonl, the reflect/ report dir, or any future state) marks the dir as
// an existing install to keep in place. Denylisting the throwaways — a small,
// stable set — is exhaustive for durable state by construction, which is safer
// than allowlisting state files (that could miss e.g. reflect/ and wrongly
// relocate a real install to XDG on upgrade).
const REGENERABLE_ENTRIES = new Set([
  'last-version-check.json', // update-check cache
  'repos-cache.json', // GitHub repo-list cache
  'last-error.json', // last error, for report-bug
  'shell-integration.sh', // shell installer artifact — not Nemus state
  '.DS_Store',
]);

export interface NemusHomeEnv {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  /** List a directory's entries; throw (or return []) when it doesn't exist. */
  readDir: (p: string) => string[];
}

/** True if ~/.nemus holds anything beyond regenerable caches / the shell artifact. */
function hasDurableState(dir: string, readDir: (p: string) => string[]): boolean {
  let entries: string[];
  try {
    entries = readDir(dir);
  } catch {
    return false; // dir doesn't exist
  }
  return entries.some((e) => !REGENERABLE_ENTRIES.has(e));
}

/**
 * Resolve the directory that holds Nemus config + state. Precedence (first
 * match wins), designed so existing users are never silently moved:
 *
 *   1. Explicit override — NEMUS_CACHE_DIR (or legacy WORKSPACE_MANAGER_CACHE_DIR).
 *   2. An existing ~/.nemus that holds durable state (anything beyond
 *      regenerable caches / the shell-integration file) — kept on every platform.
 *   3. XDG_CONFIG_HOME, when set to an absolute path — $XDG_CONFIG_HOME/nemus.
 *   4. Linux with no prior install — the XDG default ~/.config/nemus.
 *   5. Otherwise (macOS/Windows, fresh install) — ~/.nemus.
 *
 * Config + state are kept together in one dir (a later change may split cache
 * out under XDG_CACHE_HOME). The dir is chosen under XDG_CONFIG_HOME, not
 * XDG_CACHE_HOME, because it holds real config (config.json) — not disposable
 * cache a cleaner may wipe. A relative XDG_CONFIG_HOME is ignored per the spec.
 */
export function resolveNemusHome({ env, home, platform, readDir }: NemusHomeEnv): string {
  const explicit = env.NEMUS_CACHE_DIR || env.WORKSPACE_MANAGER_CACHE_DIR;
  if (explicit) return explicit;

  const branded = path.join(home, '.nemus');
  if (hasDurableState(branded, readDir)) return branded;

  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, 'nemus');

  if (platform === 'linux') return path.join(home, '.config', 'nemus');

  return branded;
}

/**
 * One-time, best-effort migration of state from the pre-0.2.2 cache location
 * (~/.workspace-manager-cache) to ~/.nemus. Runs only when using the default
 * location (no env override) and the new dir doesn't exist yet. Copies rather
 * than moves, so any other tool that happened to share the old path is left
 * untouched; a failure is harmless because a fresh dir is created on first write.
 *
 * `last-version-check.json` is deliberately NOT migrated: the old path could be
 * shared by another tool whose "latest version" is unrelated to nemus, and
 * copying it would make the update check report a wrong version until the entry
 * expires. Skipping it just forces one fresh lookup.
 *
 * Skipped when an explicit env override is in effect (don't copy into a path the
 * user deliberately chose). Runs into whatever default location was resolved,
 * including a new XDG dir on Linux.
 */
const MIGRATION_SKIP = new Set(['last-version-check.json']);
function migrateLegacyCacheDir(targetDir: string, isExplicitOverride: boolean): void {
  try {
    if (!isExplicitOverride && !fs.existsSync(targetDir) && fs.existsSync(LEGACY_CACHE_DIR)) {
      fs.cpSync(LEGACY_CACHE_DIR, targetDir, {
        recursive: true,
        filter: (src) => !MIGRATION_SKIP.has(path.basename(src)),
      });
    }
  } catch {
    // best-effort — ignore and let the dir be created lazily
  }
}

const EXPLICIT_OVERRIDE = !!(process.env.NEMUS_CACHE_DIR || process.env.WORKSPACE_MANAGER_CACHE_DIR);
const CACHE_DIR_RESOLVED = resolveNemusHome({
  env: process.env,
  home: HOME_DIR,
  platform: process.platform,
  readDir: (p) => fs.readdirSync(p),
});
migrateLegacyCacheDir(CACHE_DIR_RESOLVED, EXPLICIT_OVERRIDE);

// Config file lives inside the cache dir.
const CONFIG_FILE = path.join(CACHE_DIR_RESOLVED, 'config.json');

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

export const CONFIG_DEFAULTS: UserConfig = {
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

// Internal alias retained for the many references below.
const DEFAULTS = CONFIG_DEFAULTS;

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

export const WORKSPACES_DIR =
  process.env.NEMUS_DIR || process.env.WORKSPACE_MANAGER_DIR || initialConfig.workspacesDir;
export const CACHE_DIR = CACHE_DIR_RESOLVED;
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
