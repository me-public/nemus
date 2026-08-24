import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HOOK_MARKER } from '../types/dashboard';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/** Events we register hooks for */
const HOOK_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'] as const;

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: any;
}

/**
 * Resolve path to the compiled hook-handler.js.
 * This file (dashboard-hooks.ts) compiles to dist/utils/dashboard-hooks.js,
 * so hook-handler.js is at ../commands/dashboard/hook-handler.js relative to dist/utils/.
 */
function getHookHandlerPath(): string {
  return path.join(__dirname, '..', 'commands', 'dashboard', 'hook-handler.js');
}

/**
 * Build the hook command string for a given event.
 */
function buildHookCommand(event: string): string {
  const handlerPath = getHookHandlerPath();
  return `node "${handlerPath}" --event ${event} --marker ${HOOK_MARKER}`;
}

/**
 * Read Claude settings from disk. Returns empty settings if file doesn't exist.
 */
function readClaudeSettings(): ClaudeSettings {
  try {
    const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Write Claude settings to disk atomically (write to .tmp, then rename).
 * Prevents corruption if the process is interrupted mid-write.
 */
function writeClaudeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CLAUDE_SETTINGS_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, CLAUDE_SETTINGS_PATH);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Check if a hook group contains our dashboard hook marker.
 */
function groupContainsMarker(group: HookGroup): boolean {
  return group.hooks.some(h => h.command && h.command.includes(HOOK_MARKER));
}

/**
 * Install dashboard hooks into Claude settings.
 * Appends new hook groups — never modifies existing hooks.
 * Idempotent: skips events that already have the marker.
 */
export function installDashboardHooks(): void {
  const settings = readClaudeSettings();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // Check if already installed
    const alreadyInstalled = settings.hooks[event].some(groupContainsMarker);
    if (alreadyInstalled) {
      continue;
    }

    // Append a new hook group
    const hookGroup: HookGroup = {
      hooks: [
        {
          type: 'command',
          command: buildHookCommand(event),
          timeout: 5,
        },
      ],
    };

    // PreToolUse and PostToolUse hooks use a matcher — use empty string to match all tools
    if (event === 'PreToolUse' || event === 'PostToolUse') {
      hookGroup.matcher = '';
    }

    settings.hooks[event].push(hookGroup);
  }

  writeClaudeSettings(settings);
}

/**
 * Check if all dashboard hooks are installed.
 */
export function areDashboardHooksInstalled(): boolean {
  const settings = readClaudeSettings();
  if (!settings.hooks) return false;

  return HOOK_EVENTS.every(event => {
    const groups = settings.hooks?.[event];
    if (!groups || !Array.isArray(groups)) return false;
    return groups.some(groupContainsMarker);
  });
}

/**
 * Remove all dashboard hooks from Claude settings.
 * Only removes hook groups containing the HOOK_MARKER — leaves everything else untouched.
 */
export function uninstallDashboardHooks(): void {
  const settings = readClaudeSettings();
  if (!settings.hooks) return;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) continue;
    settings.hooks[event] = settings.hooks[event].filter(g => !groupContainsMarker(g));

    // Clean up empty arrays
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
}
