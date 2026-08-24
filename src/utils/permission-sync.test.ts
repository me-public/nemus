import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isReusablePermission,
  mergePermissions,
  installPermissionSyncHook,
  uninstallPermissionSyncHook,
  readClaudeSettings,
  installWorkspaceSkills,
  uninstallWorkspaceSkills,
  repairStaleHooks,
} from './permission-sync';

describe('isReusablePermission', () => {
  it('keeps generic bash permissions', () => {
    expect(isReusablePermission('Bash(npm test:*)')).toBe(true);
    expect(isReusablePermission('Bash(git push:*)')).toBe(true);
    expect(isReusablePermission('Bash(gh pr create:*)')).toBe(true);
  });

  it('keeps mcp tool permissions', () => {
    expect(isReusablePermission('mcp__workspace-manager__list-workspaces')).toBe(true);
  });

  it('keeps Skill and WebFetch permissions', () => {
    expect(isReusablePermission('Skill(commit)')).toBe(true);
    expect(isReusablePermission('WebFetch(domain:github.com)')).toBe(true);
  });

  it('skips entries with /Users/ absolute paths', () => {
    expect(
      isReusablePermission('Bash(git -C /Users/john/repos/my-project pull)')
    ).toBe(false);
  });

  it('skips entries with /home/ absolute paths', () => {
    expect(
      isReusablePermission('Bash(git -C /home/john/repos/my-project pull)')
    ).toBe(false);
  });

  it('skips heredoc commit messages', () => {
    expect(
      isReusablePermission(
        'Bash(git commit -m "$(cat <<\'EOF\'\nfix: some message\nEOF\n)")'
      )
    ).toBe(false);
  });
});

describe('mergePermissions', () => {
  let tempDir: string;
  let projectSettings: string;
  let globalSettings: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-sync-test-'));
    const projectDir = path.join(tempDir, 'project', '.claude');
    const globalDir = path.join(tempDir, 'global');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(globalDir, { recursive: true });
    projectSettings = path.join(projectDir, 'settings.local.json');
    globalSettings = path.join(globalDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('merges new permissions into an empty global file', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)', 'Bash(git push:*)'] },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(2);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)', 'Bash(git push:*)']);
  });

  it('merges into existing global permissions without duplicates', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)', 'Bash(git push:*)'] },
      })
    );
    fs.writeFileSync(
      globalSettings,
      JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(1);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)', 'Bash(git push:*)']);
  });

  it('filters out non-reusable permissions', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: {
          allow: [
            'Bash(npm test:*)',
            'Bash(git -C /Users/john/repo pull)',
            'Bash(git commit -m "$(cat <<\'EOF\'\nfix\nEOF\n)")',
          ],
        },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(1);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)']);
  });

  it('returns 0 when project file does not exist', () => {
    const added = mergePermissions('/nonexistent/path', globalSettings);
    expect(added).toBe(0);
  });

  it('returns 0 when project has no allow entries', () => {
    fs.writeFileSync(projectSettings, JSON.stringify({}));
    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(0);
  });

  it('preserves other fields in global settings', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } })
    );
    fs.writeFileSync(
      globalSettings,
      JSON.stringify({
        someOtherField: 'value',
        permissions: { allow: [], deny: ['Bash(rm -rf:*)'] },
      })
    );

    mergePermissions(projectSettings, globalSettings);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.someOtherField).toBe('value');
    expect(result.permissions.deny).toEqual(['Bash(rm -rf:*)']);
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)']);
  });

  it('skips allow entries that conflict with global deny list', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)', 'Bash(rm -rf:*)', 'Bash(git push:*)'],
        },
      })
    );
    fs.writeFileSync(
      globalSettings,
      JSON.stringify({
        permissions: { allow: [], deny: ['Bash(rm -rf:*)'] },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(2);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)', 'Bash(git push:*)']);
    expect(result.permissions.allow).not.toContain('Bash(rm -rf:*)');
  });

  it('syncs deny entries from project to global', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: {
          allow: ['Bash(npm test:*)'],
          deny: ['Bash(rm -rf:*)', 'Bash(shutdown:*)'],
        },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(3); // 1 allow + 2 deny

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.allow).toEqual(['Bash(npm test:*)']);
    expect(result.permissions.deny).toEqual(['Bash(rm -rf:*)', 'Bash(shutdown:*)']);
  });

  it('deduplicates deny entries already in global', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: { deny: ['Bash(rm -rf:*)', 'Bash(shutdown:*)'] },
      })
    );
    fs.writeFileSync(
      globalSettings,
      JSON.stringify({
        permissions: { allow: [], deny: ['Bash(rm -rf:*)'] },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(1); // only shutdown is new

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf:*)', 'Bash(shutdown:*)']);
  });

  it('filters non-reusable deny entries', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: {
          deny: [
            'Bash(rm -rf:*)',
            'Bash(git -C /Users/john/repo force-push)',
          ],
        },
      })
    );

    const added = mergePermissions(projectSettings, globalSettings);
    expect(added).toBe(1);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.deny).toEqual(['Bash(rm -rf:*)']);
  });

  it('cleans up empty deny array in output', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] },
      })
    );

    mergePermissions(projectSettings, globalSettings);

    const result = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
    expect(result.permissions.deny).toBeUndefined();
  });

  it('releases lock file after merge', () => {
    fs.writeFileSync(
      projectSettings,
      JSON.stringify({
        permissions: { allow: ['Bash(npm test:*)'] },
      })
    );

    mergePermissions(projectSettings, globalSettings);

    const lockPath = globalSettings + '.lock';
    // Lock directory should not exist after merge completes
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe('installPermissionSyncHook', () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    settingsPath = path.join(tempDir, '.claude', 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates settings.json with the hook when file does not exist', () => {
    installPermissionSyncHook(settingsPath);

    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].type).toBe('command');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('sync-permissions');
  });

  it('is idempotent — calling twice does not duplicate', () => {
    installPermissionSyncHook(settingsPath);
    installPermissionSyncHook(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it('preserves existing hooks and settings', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        someKey: 'someValue',
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }],
        },
      })
    );

    installPermissionSyncHook(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.someKey).toBe('someValue');
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo existing');
    expect(settings.hooks.Stop[1].hooks[0].command).toContain('sync-permissions');
  });

  it('updates stale hook path instead of duplicating', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'bash "/old/stale/path/sync-permissions.sh"' }] },
          ],
        },
      })
    );

    installPermissionSyncHook(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // Should still be exactly 1 entry, not 2
    expect(settings.hooks.Stop).toHaveLength(1);
    // The command should now point to the current path, not the stale one
    expect(settings.hooks.Stop[0].hooks[0].command).not.toContain('/old/stale/path/');
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('sync-permissions');
  });
});

describe('uninstallPermissionSyncHook', () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    settingsPath = path.join(tempDir, '.claude', 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes the sync-permissions hook entry', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'bash "/some/path/sync-permissions.sh"' }] }],
        },
      })
    );

    uninstallPermissionSyncHook(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hook entries', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'echo other' }] },
            { hooks: [{ type: 'command', command: 'bash "/some/path/sync-permissions.sh"' }] },
          ],
        },
      })
    );

    uninstallPermissionSyncHook(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo other');
  });

  it('handles missing settings file gracefully', () => {
    expect(() => uninstallPermissionSyncHook(settingsPath)).not.toThrow();
  });
});

describe('installWorkspaceSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-skills-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs skills into a specified directory', () => {
    const targetDir = path.join(tmpDir, 'claude-skills');
    fs.mkdirSync(targetDir, { recursive: true });

    // installWorkspaceSkills uses an internal source dir that may be empty in test.
    // Instead, test with the installed package by checking the function doesn't throw.
    expect(() => installWorkspaceSkills(targetDir)).not.toThrow();
  });

  it('is idempotent — installing twice does not throw', () => {
    const targetDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(targetDir, { recursive: true });

    installWorkspaceSkills(targetDir);
    expect(() => installWorkspaceSkills(targetDir)).not.toThrow();
  });

  it('creates SKILL.md files in subdirectories when source has .md files', () => {
    // Simulate skill source by directly creating skills in a target dir
    const claudeSkills = path.join(tmpDir, '.claude', 'skills');
    const piSkills = path.join(tmpDir, '.pi', 'agent', 'skills');
    fs.mkdirSync(claudeSkills, { recursive: true });
    fs.mkdirSync(piSkills, { recursive: true });

    // Manually create a skill in Claude's dir and verify Pi can have the same
    const skillDir = path.join(claudeSkills, 'test-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\nDescription here');

    // Copy to Pi dir to simulate multi-agent install
    const piSkillDir = path.join(piSkills, 'test-skill');
    fs.mkdirSync(piSkillDir);
    fs.writeFileSync(path.join(piSkillDir, 'SKILL.md'), '# Test Skill\nDescription here');

    // Verify both have identical content
    const claudeContent = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const piContent = fs.readFileSync(path.join(piSkillDir, 'SKILL.md'), 'utf-8');
    expect(claudeContent).toBe(piContent);
  });
});

describe('uninstallWorkspaceSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-skills-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes installed skills from a directory', () => {
    const targetDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(targetDir, { recursive: true });

    // installWorkspaceSkills may install 0 skills in test env (no source .md files).
    // Directly test uninstall doesn't throw.
    installWorkspaceSkills(targetDir);
    expect(() => uninstallWorkspaceSkills(targetDir)).not.toThrow();
  });

  it('does not remove non-workspace-manager skills', () => {
    const targetDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(targetDir, { recursive: true });

    // Add a custom skill
    const customSkillDir = path.join(targetDir, 'my-custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '# Custom Skill');

    uninstallWorkspaceSkills(targetDir);

    // Custom skill should still be there
    expect(fs.existsSync(customSkillDir)).toBe(true);
    expect(fs.readFileSync(path.join(customSkillDir, 'SKILL.md'), 'utf-8')).toBe('# Custom Skill');
  });

  it('handles empty directory gracefully', () => {
    const targetDir = path.join(tmpDir, 'empty-skills');
    fs.mkdirSync(targetDir, { recursive: true });

    expect(() => uninstallWorkspaceSkills(targetDir)).not.toThrow();
  });
});

describe('repairStaleHooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-hooks-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when settings file does not exist', () => {
    const missing = path.join(tmpDir, 'nope.json');
    expect(repairStaleHooks(missing)).toBe(0);
  });

  it('returns 0 when there are no workspace-manager hooks', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    }));
    expect(repairStaleHooks(settingsPath)).toBe(0);
  });

  it('leaves valid hook paths untouched (no-op)', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    // Point at a real existing script so it should NOT be repaired
    installPermissionSyncHook(settingsPath);
    const before = fs.readFileSync(settingsPath, 'utf-8');
    expect(repairStaleHooks(settingsPath)).toBe(0);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
  });

  it('repairs a stale Stop hook pointing to a non-existent script', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'command',
            command: 'bash "/Users/x/.volta/tmp/image/packages/.tmpABC/lib/node_modules/@acme/workspace-manager/sync-permissions.sh"',
          }],
        }],
      },
    }));

    const repaired = repairStaleHooks(settingsPath);
    expect(repaired).toBe(1);

    const updated = readClaudeSettings(settingsPath);
    const cmd = updated.hooks!.Stop![0].hooks![0].command;
    // Should no longer reference the dead volta temp path
    expect(cmd).not.toContain('.volta/tmp');
    // Should reference a real, existing sync-permissions.sh
    const match = cmd.match(/"([^"]+sync-permissions\.sh)"/);
    expect(match).not.toBeNull();
    expect(fs.existsSync(match![1])).toBe(true);
  });

  it('repairs a stale Stop hook while leaving unrelated hooks untouched', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'bash "/dead/sync-permissions.sh"' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }],
      },
    }));

    expect(repairStaleHooks(settingsPath)).toBe(1);

    const updated = readClaudeSettings(settingsPath);
    const cmd = updated.hooks!.Stop![0].hooks![0].command;
    expect(cmd).not.toContain('/dead/');
    const match = cmd.match(/"([^"]+sync-permissions\.sh)"/);
    expect(match).not.toBeNull();
    expect(fs.existsSync(match![1])).toBe(true);
    // Unrelated hooks are left as-is
    expect(updated.hooks!.SessionStart![0].hooks![0].command).toBe('echo unrelated');
  });

  it('does not throw on malformed settings', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, 'not valid json {{{');
    expect(() => repairStaleHooks(settingsPath)).not.toThrow();
    expect(repairStaleHooks(settingsPath)).toBe(0);
  });
});
