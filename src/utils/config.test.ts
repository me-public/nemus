import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

describe('config', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-config-test-'));
    const cacheDir = path.join(tempDir, '.workspace-manager-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    process.env.WORKSPACE_MANAGER_DIR = path.join(tempDir, 'workspaces');
    process.env.WORKSPACE_MANAGER_CACHE_DIR = cacheDir;
    vi.mocked(os.homedir).mockReturnValue(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function loadModule() {
    return await import('./config');
  }

  describe('getCloneUrl', () => {
    it('returns sshUrl by default (ssh protocol)', async () => {
      const { getCloneUrl } = await loadModule();
      const repo = { url: 'https://github.com/acme/my-repo', sshUrl: 'git@github.com:acme/my-repo.git' };
      expect(getCloneUrl(repo)).toBe('git@github.com:acme/my-repo.git');
    });

    it('returns https url with .git suffix when protocol is https', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ cloneProtocol: 'https' })
      );

      const { getCloneUrl } = await loadModule();
      const repo = { url: 'https://github.com/acme/my-repo', sshUrl: 'git@github.com:acme/my-repo.git' };
      expect(getCloneUrl(repo)).toBe('https://github.com/acme/my-repo.git');
    });

    it('does not double-append .git', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ cloneProtocol: 'https' })
      );

      const { getCloneUrl } = await loadModule();
      const repo = { url: 'https://github.com/acme/my-repo.git', sshUrl: 'git@github.com:acme/my-repo.git' };
      expect(getCloneUrl(repo)).toBe('https://github.com/acme/my-repo.git');
    });
  });

  describe('getPackageVersion', () => {
    it('returns a semver-like string', async () => {
      const { getPackageVersion } = await loadModule();
      const version = getPackageVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('getUserConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const { getUserConfig } = await loadModule();
      const cfg = getUserConfig();
      expect(cfg.githubOrg).toBe('');
      expect(cfg.cloneProtocol).toBe('ssh');
      expect(cfg.autoLaunchClaude).toBe(true);
      expect(cfg.generateClaudeContext).toBe(true);
      expect(cfg.installMcp).toBe(true);
      expect(cfg.aiAgent).toBe('auto');
      expect(cfg.primaryAgent).toBe('auto');
    });

    it('reads fresh values from disk on each call', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ githubOrg: 'org-a' })
      );

      const { getUserConfig } = await loadModule();
      expect(getUserConfig().githubOrg).toBe('org-a');

      // Update config on disk
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ githubOrg: 'org-b' })
      );

      // Should see the new value without re-importing
      expect(getUserConfig().githubOrg).toBe('org-b');
    });

    it('ignores invalid field types from config file', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({
          githubOrg: 123,
          cloneProtocol: 'ftp',
          autoLaunchClaude: 'yes',
          workspacesDir: null,
          installMcp: 'true',
          aiAgent: 'invalid',
        })
      );

      const { getUserConfig } = await loadModule();
      const cfg = getUserConfig();
      // All invalid values should be ignored, defaults used
      expect(cfg.githubOrg).toBe('');
      expect(cfg.cloneProtocol).toBe('ssh');
      expect(cfg.autoLaunchClaude).toBe(true);
      expect(cfg.workspacesDir).toContain('workspaces');
      expect(cfg.installMcp).toBe(true);
      expect(cfg.aiAgent).toBe('auto');
    });
  });

  describe('saveUserConfig', () => {
    it('writes config to disk and can be read back', async () => {
      const { saveUserConfig, getUserConfig } = await loadModule();

      saveUserConfig({
        workspacesDir: '/custom/path',
        githubOrg: 'test-org',
        autoLaunchClaude: false,
        generateClaudeContext: false,
        cloneProtocol: 'https',
        installMcp: false,
        aiAgent: 'pi',
        primaryAgent: 'pi',
      });

      const cfg = getUserConfig();
      expect(cfg.githubOrg).toBe('test-org');
      expect(cfg.cloneProtocol).toBe('https');
      expect(cfg.autoLaunchClaude).toBe(false);
      expect(cfg.aiAgent).toBe('pi');
      expect(cfg.primaryAgent).toBe('pi');
    });
  });

  describe('aiAgent config', () => {
    it('reads aiAgent "claude" from config file', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ aiAgent: 'claude' })
      );

      const { getUserConfig } = await loadModule();
      expect(getUserConfig().aiAgent).toBe('claude');
    });

    it('reads aiAgent "pi" from config file', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ aiAgent: 'pi' })
      );

      const { getUserConfig } = await loadModule();
      expect(getUserConfig().aiAgent).toBe('pi');
    });

    it('reads aiAgent "both" from config file', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ aiAgent: 'both' })
      );

      const { getUserConfig } = await loadModule();
      expect(getUserConfig().aiAgent).toBe('both');
    });

    it('ignores invalid aiAgent values', async () => {
      const cacheDir = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(
        path.join(cacheDir, 'config.json'),
        JSON.stringify({ aiAgent: 'copilot' })
      );

      const { getUserConfig } = await loadModule();
      expect(getUserConfig().aiAgent).toBe('auto');
    });
  });

  describe('cache dir location + legacy migration', () => {
    it('defaults CACHE_DIR to ~/.nemus when no env override is set', async () => {
      delete process.env.NEMUS_CACHE_DIR;
      delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
      vi.resetModules();
      const { CACHE_DIR } = await loadModule();
      expect(CACHE_DIR).toBe(path.join(tempDir, '.nemus'));
    });

    it('prefers NEMUS_CACHE_DIR, then legacy WORKSPACE_MANAGER_CACHE_DIR', async () => {
      const nemusCache = path.join(tempDir, 'custom-nemus-cache');
      process.env.NEMUS_CACHE_DIR = nemusCache;
      vi.resetModules();
      expect((await loadModule()).CACHE_DIR).toBe(nemusCache);

      delete process.env.NEMUS_CACHE_DIR;
      process.env.WORKSPACE_MANAGER_CACHE_DIR = path.join(tempDir, '.workspace-manager-cache');
      vi.resetModules();
      expect((await loadModule()).CACHE_DIR).toBe(path.join(tempDir, '.workspace-manager-cache'));
    });

    it('migrates state from ~/.workspace-manager-cache to ~/.nemus on first run', async () => {
      delete process.env.NEMUS_CACHE_DIR;
      delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
      // legacy dir (created by beforeEach) holds prior state; new dir absent
      fs.writeFileSync(path.join(tempDir, '.workspace-manager-cache', 'suites.json'), '{"x":1}');
      expect(fs.existsSync(path.join(tempDir, '.nemus'))).toBe(false);
      vi.resetModules();
      const { CACHE_DIR } = await loadModule();
      expect(CACHE_DIR).toBe(path.join(tempDir, '.nemus'));
      // copied, not moved: file exists in the new dir AND the legacy dir survives
      expect(fs.readFileSync(path.join(tempDir, '.nemus', 'suites.json'), 'utf-8')).toBe('{"x":1}');
      expect(fs.existsSync(path.join(tempDir, '.workspace-manager-cache', 'suites.json'))).toBe(true);
    });

    it('does not migrate last-version-check.json (avoids inheriting a foreign latest)', async () => {
      delete process.env.NEMUS_CACHE_DIR;
      delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
      const legacy = path.join(tempDir, '.workspace-manager-cache');
      fs.writeFileSync(path.join(legacy, 'suites.json'), '{"x":1}');
      fs.writeFileSync(path.join(legacy, 'last-version-check.json'), '{"latestVersion":"99.0.0"}');
      vi.resetModules();
      await loadModule();
      // other state migrates, but the version-check cache is left behind
      expect(fs.existsSync(path.join(tempDir, '.nemus', 'suites.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.nemus', 'last-version-check.json'))).toBe(false);
    });

    it('does not migrate when the new dir already exists', async () => {
      delete process.env.NEMUS_CACHE_DIR;
      delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
      fs.mkdirSync(path.join(tempDir, '.nemus'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, '.workspace-manager-cache', 'suites.json'), '{"x":1}');
      vi.resetModules();
      await loadModule();
      expect(fs.existsSync(path.join(tempDir, '.nemus', 'suites.json'))).toBe(false);
    });
  });
});
