import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logSuccess, logInfo, logWarning } from './logger';
import { getSkillsTargetDirs, getAgentPaths } from './agent-config';

function getDefaultClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Returns the shell command used for the Stop hook entry.
 * Resolves to the sync-permissions.sh script bundled with this package.
 */
export function getPermissionSyncHookCommand(): string {
  // __dirname is dist/utils/ or src/utils/ — either way, two levels up is project root
  const scriptPath = path.resolve(__dirname, '..', '..', 'sync-permissions.sh');

  if (fs.existsSync(scriptPath)) {
    return `bash "${scriptPath}"`;
  }

  throw new Error(
    'Could not find sync-permissions.sh. Make sure the package is installed correctly.'
  );
}

interface ClaudeHookCommand {
  type: 'command';
  command: string;
}

interface ClaudeHookMatcherEntry {
  matcher?: string;
  hooks: ClaudeHookCommand[];
}

interface ClaudeHooksConfig {
  [event: string]: ClaudeHookMatcherEntry[];
}

interface ClaudeSettings {
  hooks?: ClaudeHooksConfig;
  [key: string]: unknown;
}

export function readClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeClaudeSettings(settingsPath: string, settings: ClaudeSettings): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, settingsPath);
}

function matcherEntryContainsCommand(entry: ClaudeHookMatcherEntry, needle: string): boolean {
  return entry.hooks?.some((h) => h.command.includes(needle)) ?? false;
}

function getCommandFromMatcherEntry(entry: ClaudeHookMatcherEntry): string | undefined {
  return entry.hooks?.[0]?.command;
}

/**
 * Install the permission-sync Stop hook into ~/.claude/settings.json.
 * Idempotent — if a sync-permissions hook already exists with the same command,
 * it's left as-is. If it exists with a different path (stale from a previous
 * install location), the command is updated in place.
 *
 * Uses the Claude Code hooks format:
 *   { hooks: [{ type: "command", command: "..." }] }
 *
 * @param settingsPath - Override the settings file path (for testing).
 */
export function installPermissionSyncHook(settingsPath?: string): void {
  const filePath = settingsPath ?? getDefaultClaudeSettingsPath();

  let command: string;
  try {
    command = getPermissionSyncHookCommand();
  } catch (err) {
    logWarning(
      `Could not locate sync-permissions.sh — skipping hook installation. ${
        err instanceof Error ? err.message : ''
      }`
    );
    return;
  }

  const settings = readClaudeSettings(filePath);

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  const existingIndex = settings.hooks.Stop.findIndex(
    (entry) => matcherEntryContainsCommand(entry, 'sync-permissions')
  );

  if (existingIndex !== -1) {
    if (getCommandFromMatcherEntry(settings.hooks.Stop[existingIndex]) === command) {
      logInfo('Permission sync hook already installed');
      return;
    }
    // Stale path from a previous install — update in place
    settings.hooks.Stop[existingIndex].hooks = [{ type: 'command', command }];
    writeClaudeSettings(filePath, settings);
    logSuccess('Permission sync hook updated in ~/.claude/settings.json');
    return;
  }

  settings.hooks.Stop.push({
    hooks: [{ type: 'command', command }],
  });

  writeClaudeSettings(filePath, settings);
  logSuccess('Permission sync hook installed in ~/.claude/settings.json');
}

/**
 * Remove the permission-sync Stop hook from ~/.claude/settings.json.
 *
 * @param settingsPath - Override the settings file path (for testing).
 */
export function uninstallPermissionSyncHook(settingsPath?: string): void {
  const filePath = settingsPath ?? getDefaultClaudeSettingsPath();
  const settings = readClaudeSettings(filePath);

  if (!settings.hooks?.Stop) {
    logInfo('No permission sync hook found to remove');
    return;
  }

  const before = settings.hooks.Stop.length;
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (entry) => !matcherEntryContainsCommand(entry, 'sync-permissions')
  );
  const after = settings.hooks.Stop.length;

  if (before === after) {
    logInfo('No permission sync hook found to remove');
    return;
  }

  // Clean up empty arrays/objects
  if (settings.hooks.Stop.length === 0) {
    delete settings.hooks.Stop;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(filePath, settings);
  logSuccess('Permission sync hook removed from ~/.claude/settings.json');
}

/**
 * Returns true if a permission entry is reusable (should be promoted to global).
 * Filters out absolute-path entries and heredoc commit messages.
 *
 * IMPORTANT: Keep in sync with the equivalent jq filter (IS_REUSABLE) in
 * sync-permissions.sh — both must apply the same rules.
 */
export function isReusablePermission(entry: string): boolean {
  // Skip entries with absolute user home paths
  if (/\/Users\/|\/home\//.test(entry)) {
    return false;
  }
  // Skip heredoc commit messages
  if (/cat <<.*EOF/.test(entry)) {
    return false;
  }
  return true;
}

/**
 * Synchronous sleep using Atomics.wait (no busy-wait CPU burn).
 * Falls back to a short busy-wait if SharedArrayBuffer is unavailable.
 */
function sleepMs(ms: number): void {
  try {
    const buf = new SharedArrayBuffer(4);
    const arr = new Int32Array(buf);
    Atomics.wait(arr, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* fallback busy wait */ }
  }
}

/**
 * Simple file-based lock using mkdir (atomic on all platforms).
 * Returns a release function, or null if the lock could not be acquired.
 */
function acquireFileLock(lockPath: string, timeoutMs: number = 5000): (() => void) | null {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return () => {
        try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
      };
    } catch {
      if (Date.now() - start > timeoutMs) {
        // Stale lock — force-remove and retry once
        try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
        try {
          fs.mkdirSync(lockPath);
          return () => {
            try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
          };
        } catch {
          return null;
        }
      }
      sleepMs(50);
    }
  }
}

interface PermissionsBlock {
  allow?: string[];
  deny?: string[];
}

interface SettingsWithPermissions {
  permissions?: PermissionsBlock;
  [key: string]: unknown;
}

/**
 * Merge permissions from a project settings.local.json into the global settings.json.
 * - Syncs both allow and deny entries
 * - Skips non-reusable entries (absolute paths, heredoc commits)
 * - Skips allow entries that conflict with the global deny list
 * - Uses file locking to prevent concurrent write corruption
 *
 * Returns the total number of new entries added (allow + deny).
 */
export function mergePermissions(projectSettingsPath: string, globalSettingsPath: string): number {
  if (!fs.existsSync(projectSettingsPath)) {
    return 0;
  }

  let projectSettings: SettingsWithPermissions;
  try {
    projectSettings = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf-8'));
  } catch {
    return 0;
  }

  const projectAllow = projectSettings?.permissions?.allow ?? [];
  const projectDeny = projectSettings?.permissions?.deny ?? [];
  if (projectAllow.length === 0 && projectDeny.length === 0) {
    return 0;
  }

  // Acquire lock for the read-modify-write cycle
  const lockPath = globalSettingsPath + '.lock';
  const releaseLock = acquireFileLock(lockPath);
  if (!releaseLock) {
    return 0;
  }

  try {
    let globalSettings: SettingsWithPermissions;
    if (fs.existsSync(globalSettingsPath)) {
      try {
        globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf-8'));
      } catch {
        globalSettings = {};
      }
    } else {
      globalSettings = {};
    }

    if (!globalSettings.permissions) {
      globalSettings.permissions = {};
    }
    if (!globalSettings.permissions.allow) {
      globalSettings.permissions.allow = [];
    }
    if (!globalSettings.permissions.deny) {
      globalSettings.permissions.deny = [];
    }

    const globalAllowSet = new Set(globalSettings.permissions.allow);
    const globalDenySet = new Set(globalSettings.permissions.deny);
    let added = 0;

    // Merge allow entries (skip if in global deny)
    for (const entry of projectAllow) {
      if (!isReusablePermission(entry)) continue;
      if (globalAllowSet.has(entry)) continue;
      if (globalDenySet.has(entry)) continue;
      globalSettings.permissions.allow.push(entry);
      globalAllowSet.add(entry);
      added++;
    }

    // Merge deny entries
    for (const entry of projectDeny) {
      if (!isReusablePermission(entry)) continue;
      if (globalDenySet.has(entry)) continue;
      globalSettings.permissions.deny.push(entry);
      globalDenySet.add(entry);
      added++;
    }

    // Clean up empty arrays
    if (globalSettings.permissions.deny.length === 0) {
      delete globalSettings.permissions.deny;
    }

    if (added > 0) {
      const dir = path.dirname(globalSettingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = globalSettingsPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(globalSettings, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmp, globalSettingsPath);
    }

    return added;
  } finally {
    releaseLock();
  }
}

/**
 * Scan all workspaces under a directory and merge their permissions into global.
 *
 * Directory structure: workspacesDir/workspace-name/repo-name/.claude/settings.local.json
 * We check both the workspace level (for workspace-scoped settings) and one level deeper
 * (for repo-scoped settings within each workspace).
 */
export function syncAllWorkspacePermissions(workspacesDir: string): void {
  // Write to settings.json (not settings.local.json) because Claude Code only
  // reads ~/.claude/settings.json at the user level. The .local.json variant
  // is only recognized at the project level.
  const globalSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  if (!fs.existsSync(workspacesDir)) {
    logWarning(`Workspaces directory not found: ${workspacesDir}`);
    return;
  }

  let totalAdded = 0;
  const workspaces = fs.readdirSync(workspacesDir, { withFileTypes: true });

  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;

    const workspacePath = path.join(workspacesDir, workspace.name);

    // Check workspace-level settings
    const workspaceSettings = path.join(workspacePath, '.claude', 'settings.local.json');
    const wsAdded = mergePermissions(workspaceSettings, globalSettingsPath);
    if (wsAdded > 0) {
      logInfo(`Merged ${wsAdded} permission(s) from ${workspace.name}`);
      totalAdded += wsAdded;
    }

    // Check repo-level settings within the workspace
    let repos: fs.Dirent[];
    try {
      repos = fs.readdirSync(workspacePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const repo of repos) {
      if (!repo.isDirectory()) continue;

      const repoSettings = path.join(workspacePath, repo.name, '.claude', 'settings.local.json');
      const repoAdded = mergePermissions(repoSettings, globalSettingsPath);
      if (repoAdded > 0) {
        logInfo(`Merged ${repoAdded} permission(s) from ${workspace.name}/${repo.name}`);
        totalAdded += repoAdded;
      }
    }
  }

  if (totalAdded > 0) {
    logSuccess(`Synced ${totalAdded} new permission(s) to global settings`);
  } else {
    logInfo('No new permissions to sync');
  }
}

// ---------------------------------------------------------------------------
// Workspace-manager skills (MCP + CLI command skills)
// ---------------------------------------------------------------------------

function getSkillsSourceDir(): string {
  // __dirname is dist/utils/ or src/utils/ — either way, two levels up is project root
  const dir = path.resolve(__dirname, '..', '..', 'skills');
  if (fs.existsSync(dir)) {
    return dir;
  }
  throw new Error('Could not find skills/ directory. Make sure the package is installed correctly.');
}

/**
 * Install all workspace-manager skills from the skills/ directory.
 * Each .md file becomes a skill under <skillsDir>/<skill-name>/SKILL.md.
 * Installs to all active agent skills directories.
 * Idempotent — safe to call multiple times.
 */
export function installWorkspaceSkills(skillsDir?: string): void {
  let sourceDir: string;
  try {
    sourceDir = getSkillsSourceDir();
  } catch {
    return; // skills dir not found — skip silently (non-critical)
  }

  // If a specific dir is provided (e.g. from tests), install only there.
  // Otherwise install to all active agent directories.
  const targetDirs = skillsDir ? [skillsDir] : getSkillsTargetDirs();

  // Collect installable skills from source:
  // 1. Flat .md files → installed as <name>/SKILL.md
  // 2. Directories containing SKILL.md → copied recursively (includes references/)
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const flatFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
  const skillDirs = entries.filter(e => e.isDirectory() && fs.existsSync(path.join(sourceDir, e.name, 'SKILL.md')));

  for (const targetBase of targetDirs) {
    let installed = 0;

    // Install flat .md files as <name>/SKILL.md
    for (const entry of flatFiles) {
      const skillName = entry.name.replace(/\.md$/, '');
      const targetDir = path.join(targetBase, skillName);
      const targetPath = path.join(targetDir, 'SKILL.md');
      const sourcePath = path.join(sourceDir, entry.name);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const content = fs.readFileSync(sourcePath, 'utf-8');
      fs.writeFileSync(targetPath, content, 'utf-8');
      installed++;
    }

    // Install skill directories (copy SKILL.md + references/ etc.)
    for (const entry of skillDirs) {
      const skillSourceDir = path.join(sourceDir, entry.name);
      const targetDir = path.join(targetBase, entry.name);
      copyDirRecursive(skillSourceDir, targetDir);
      installed++;
    }

    if (installed > 0) {
      logSuccess(`Installed ${installed} workspace-manager skills in ${targetBase}`);
    }
  }
}

/** Recursively copy a directory, creating target dirs as needed. */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Remove all workspace-manager skills from all possible agent directories.
 * Reads the skills/ source directory to know which skill names to remove.
 * Removes from both Claude and Pi dirs regardless of current config to avoid orphans.
 */
export function uninstallWorkspaceSkills(skillsDir?: string): void {
  let sourceDir: string;
  try {
    sourceDir = getSkillsSourceDir();
  } catch {
    return;
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const flatFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
  const skillDirs = entries.filter(e => e.isDirectory() && fs.existsSync(path.join(sourceDir, e.name, 'SKILL.md')));

  // Collect all skill names to remove
  const skillNames = [
    ...flatFiles.map(e => e.name.replace(/\.md$/, '')),
    ...skillDirs.map(e => e.name),
  ];

  // If specific dir provided, use that. Otherwise, uninstall from ALL agent dirs
  // to avoid orphan skills when user changes config.
  // Note: OpenCode reads from ~/.claude/skills/ natively, so no separate dir needed.
  const targetDirs = skillsDir ? [skillsDir] : [
    getAgentPaths('claude').skillsDir,
    getAgentPaths('pi').skillsDir,
  ];

  for (const targetBase of targetDirs) {
    for (const skillName of skillNames) {
      const targetDir = path.join(targetBase, skillName);
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }
  }
}

// ─── Workspace status-line ────────────────────────────────────────────────────

/** Absolute install path for the workspace-table Python script. */
const WORKSPACE_TABLE_SCRIPT = path.join(os.homedir(), '.workspace-manager-table.py');

/**
 * Resolve the bundled workspace-table.py path from the installed package.
 * When compiled, __dirname is dist/utils/; the scripts/ dir is at dist/scripts/.
 */
function getWorkspaceTableSourcePath(): string {
  const distPath = path.join(__dirname, '..', 'scripts', 'workspace-table.py');
  const srcPath = path.join(__dirname, '..', '..', 'src', 'scripts', 'workspace-table.py');
  if (fs.existsSync(distPath)) return distPath;
  if (fs.existsSync(srcPath)) return srcPath;
  throw new Error('Could not find workspace-table.py in package');
}

/**
 * Install the workspace repo-table as an *additional* statusLine in Claude Code.
 *
 * The script only outputs content when the cwd is inside a workspace AND at
 * least one repo has a non-default branch. Otherwise it exits silently and
 * Claude Code shows its default footer — the user's existing styling is
 * never affected.
 *
 * The script is copied to ~/.workspace-manager-table.py and registered in
 * ~/.claude/settings.json only when no statusLine is already configured —
 * we never overwrite a custom status line the user already has.
 *
 * @param settingsPath Override ~/.claude/settings.json (for testing).
 */
export function installWorkspaceStatusLine(settingsPath?: string): void {
  const filePath = settingsPath ?? getDefaultClaudeSettingsPath();
  const settings = readClaudeSettings(filePath);

  if ((settings as any).statusLine) {
    logInfo('statusLine already configured in ~/.claude/settings.json — skipping workspace-table install');
    logInfo(`  To use workspace-manager\'s table, replace your statusLine command with: ${WORKSPACE_TABLE_SCRIPT}`);
    return;
  }

  // Copy the script
  let sourcePath: string;
  try {
    sourcePath = getWorkspaceTableSourcePath();
  } catch {
    logWarning('Could not locate workspace-table.py — skipping status-line install');
    return;
  }
  fs.copyFileSync(sourcePath, WORKSPACE_TABLE_SCRIPT);
  fs.chmodSync(WORKSPACE_TABLE_SCRIPT, 0o755);

  // Register in settings.json
  (settings as any).statusLine = {
    type: 'command',
    command: WORKSPACE_TABLE_SCRIPT,
    padding: 0,
  };
  writeClaudeSettings(filePath, settings);
  logSuccess(`Workspace status-line installed (${WORKSPACE_TABLE_SCRIPT})`);
}

/**
 * Remove the workspace status-line from Claude Code\'s settings.json.
 * Only removes it if the command points to workspace-manager\'s own script.
 *
 * @param settingsPath Override ~/.claude/settings.json (for testing).
 */
export function uninstallWorkspaceStatusLine(settingsPath?: string): void {
  const filePath = settingsPath ?? getDefaultClaudeSettingsPath();
  const settings = readClaudeSettings(filePath);
  const existing = (settings as any).statusLine;

  if (!existing) {
    logInfo('No statusLine configured — nothing to remove');
    return;
  }

  const cmd: string = existing.command ?? '';
  if (!cmd.includes('workspace-manager-table')) {
    logInfo('statusLine is not managed by workspace-manager — leaving it unchanged');
    return;
  }

  delete (settings as any).statusLine;
  writeClaudeSettings(filePath, settings);

  // Remove the installed script if it exists
  if (fs.existsSync(WORKSPACE_TABLE_SCRIPT)) {
    try { fs.unlinkSync(WORKSPACE_TABLE_SCRIPT); } catch { /* ignore */ }
  }
  logSuccess('Workspace status-line removed from ~/.claude/settings.json');
}

// ─── Self-heal stale hook paths ──────────────────────────────────────────────

/** Extract the script path (…/foo.sh or …/foo.py) referenced by a hook command. */
function extractScriptPath(command: string): string | null {
  // Commands look like: bash "/abs/path/sync-permissions.sh"  or  /abs/path/table.py
  const quoted = command.match(/"([^"]+\.(?:sh|py|js))"/);
  if (quoted) return quoted[1];
  const bare = command.match(/(\/[^\s"']+\.(?:sh|py|js))/);
  return bare ? bare[1] : null;
}

/**
 * Detect and repair workspace-manager hook commands in ~/.claude/settings.json
 * that point to script paths which no longer exist on disk.
 *
 * This happens when the package is installed via a manager (e.g. Volta) whose
 * postinstall runs from an ephemeral temp staging dir
 * (~/.volta/tmp/image/packages/.tmpXXXX/...). That dead path gets baked into
 * settings.json; once the temp dir is cleaned up the Stop/SessionStart/
 * PostToolUse hooks fail with "No such file or directory".
 *
 * Called best-effort on CLI startup. Because the CLI runs from the package's
 * STABLE install location (the bin shim resolves there), re-resolving the hook
 * commands here produces correct, durable paths.
 *
 * Returns the number of hooks repaired. Silent and non-throwing.
 *
 * @param settingsPath Override ~/.claude/settings.json (for testing).
 */
export function repairStaleHooks(settingsPath?: string): number {
  const filePath = settingsPath ?? getDefaultClaudeSettingsPath();

  let settings: ClaudeSettings;
  try {
    if (!fs.existsSync(filePath)) return 0;
    settings = readClaudeSettings(filePath);
  } catch {
    return 0;
  }
  if (!settings.hooks) return 0;

  // (hook category, command-substring identifying our hook, fresh-command resolver)
  const specs: Array<{
    category: 'Stop' | 'SessionStart' | 'PostToolUse';
    needle: string;
    resolve: () => string;
  }> = [
    { category: 'Stop', needle: 'sync-permissions', resolve: getPermissionSyncHookCommand },
  ];

  let repaired = 0;

  for (const spec of specs) {
    const entries = settings.hooks[spec.category];
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!matcherEntryContainsCommand(entry, spec.needle)) continue;
      const current = getCommandFromMatcherEntry(entry);
      if (!current) continue;

      const scriptPath = extractScriptPath(current);
      // Only repair when the referenced script is genuinely missing.
      if (scriptPath && fs.existsSync(scriptPath)) continue;

      let fresh: string;
      try {
        fresh = spec.resolve();
      } catch {
        continue; // can't resolve a stable path right now — leave as-is
      }
      if (fresh === current) continue;

      if (entry.hooks) {
        entry.hooks = entry.hooks.map((h) =>
          h.command.includes(spec.needle) ? { ...h, command: fresh } : h
        );
        repaired++;
      }
    }
  }

  if (repaired > 0) {
    try {
      writeClaudeSettings(filePath, settings);
    } catch {
      return 0;
    }
  }
  return repaired;
}
