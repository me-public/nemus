import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HOOK_MARKER } from '../types/dashboard';

let tmpDir: string;
let settingsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
  settingsPath = path.join(tmpDir, '.claude', 'settings.json');
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  // Reset module cache so each test gets a fresh import
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeSettings(content: any) {
  fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2), 'utf-8');
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

async function importModule() {
  // Mock os.homedir to return our temp dir before importing the module
  vi.doMock('os', () => ({
    ...os,
    homedir: () => tmpDir,
  }));
  return await import('./dashboard-hooks');
}

describe('dashboard-hooks', () => {
  it('installDashboardHooks into empty settings', async () => {
    writeSettings({});
    const { installDashboardHooks } = await importModule();
    installDashboardHooks();

    const settings = readSettings();
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.UserPromptSubmit).toBeDefined();
    expect(settings.hooks.Notification).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();

    // Each should have exactly one group with our marker
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      const groups = settings.hooks[event];
      expect(groups.length).toBeGreaterThanOrEqual(1);
      const ourGroup = groups.find((g: any) =>
        g.hooks.some((h: any) => h.command?.includes(HOOK_MARKER))
      );
      expect(ourGroup).toBeDefined();
    }
  });

  it('installDashboardHooks preserves existing hooks', async () => {
    writeSettings({
      hooks: {
        Notification: [
          { hooks: [{ type: 'command', command: 'echo existing-notification' }] }
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'echo existing-stop' }] }
        ],
      },
    });

    const { installDashboardHooks } = await importModule();
    installDashboardHooks();

    const settings = readSettings();

    // Existing hooks should still be there
    expect(settings.hooks.Notification[0].hooks[0].command).toBe('echo existing-notification');
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo existing-stop');

    // Our hooks should be appended
    expect(settings.hooks.Notification.length).toBe(2);
    expect(settings.hooks.Stop.length).toBe(2);
  });

  it('installDashboardHooks is idempotent', async () => {
    writeSettings({});
    const { installDashboardHooks } = await importModule();

    installDashboardHooks();
    const firstInstall = readSettings();

    installDashboardHooks();
    const secondInstall = readSettings();

    // Should have same number of hook groups
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      expect(secondInstall.hooks[event].length).toBe(firstInstall.hooks[event].length);
    }
  });

  it('areDashboardHooksInstalled returns false when not installed', async () => {
    writeSettings({});
    const { areDashboardHooksInstalled } = await importModule();
    expect(areDashboardHooksInstalled()).toBe(false);
  });

  it('areDashboardHooksInstalled returns true after install', async () => {
    writeSettings({});
    const { installDashboardHooks, areDashboardHooksInstalled } = await importModule();
    installDashboardHooks();
    expect(areDashboardHooksInstalled()).toBe(true);
  });

  it('uninstallDashboardHooks removes only our hooks', async () => {
    writeSettings({
      hooks: {
        Notification: [
          { hooks: [{ type: 'command', command: 'echo keep-this' }] },
          { hooks: [{ type: 'command', command: `node /path/handler --marker ${HOOK_MARKER}` }] },
        ],
      },
    });

    const { uninstallDashboardHooks } = await importModule();
    uninstallDashboardHooks();

    const settings = readSettings();
    expect(settings.hooks.Notification.length).toBe(1);
    expect(settings.hooks.Notification[0].hooks[0].command).toBe('echo keep-this');
  });

  it('uninstallDashboardHooks handles missing settings gracefully', async () => {
    // No settings file — should not throw
    const { uninstallDashboardHooks } = await importModule();
    expect(() => uninstallDashboardHooks()).not.toThrow();
  });

  it('settings file created when missing', async () => {
    // Ensure no settings file exists
    try { fs.unlinkSync(settingsPath); } catch { /* fine */ }

    const { installDashboardHooks } = await importModule();
    installDashboardHooks();

    expect(fs.existsSync(settingsPath)).toBe(true);
  });

  it('PreToolUse hook has empty matcher', async () => {
    writeSettings({});
    const { installDashboardHooks } = await importModule();
    installDashboardHooks();

    const settings = readSettings();
    const ourGroup = settings.hooks.PreToolUse.find((g: any) =>
      g.hooks.some((h: any) => h.command?.includes(HOOK_MARKER))
    );
    expect(ourGroup).toBeDefined();
    expect(ourGroup.matcher).toBe('');
  });
});
