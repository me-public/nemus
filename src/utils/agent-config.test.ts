import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock os.homedir so agent-config computes paths relative to our temp dir
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

// Mock child_process for CLI availability checks
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: vi.fn(actual.execSync) };
});

const execSync = vi.mocked(await import('child_process')).execSync;

describe('agent-config', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
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

  function writeConfig(cfg: Record<string, unknown>) {
    const cacheDir = path.join(tempDir, '.workspace-manager-cache');
    fs.writeFileSync(path.join(cacheDir, 'config.json'), JSON.stringify(cfg));
  }

  async function loadModule() {
    // Default mock: only claude and pi CLIs are available
    // Tests that need all agents or specific availability override this before/after calling loadModule
    execSync.mockImplementation((cmd: string) => {
      if (cmd.toString().includes('claude --version')) return Buffer.from('1.0.0');
      if (cmd.toString().includes('pi --version')) return Buffer.from('1.0.0');
      throw new Error('not found');
    });
    const mod = await import('./agent-config');
    // Reset caches to ensure clean state for each test
    mod.resetAgentConfigCache();
    return mod;
  }

  describe('getAgentPaths', () => {
    it('returns Claude paths for "claude"', async () => {
      const { getAgentPaths } = await loadModule();
      const paths = getAgentPaths('claude');
      expect(paths.type).toBe('claude');
      expect(paths.skillsDir).toContain('.claude');
      expect(paths.skillsDir).toContain('skills');
      expect(paths.contextFileName).toBe('CLAUDE.md');
      expect(paths.launchCommand).toBe('claude');
      expect(paths.supportsMcp).toBe(true);
      expect(paths.supportsHooks).toBe(true);
    });

    it('returns Pi paths for "pi"', async () => {
      const { getAgentPaths } = await loadModule();
      const paths = getAgentPaths('pi');
      expect(paths.type).toBe('pi');
      expect(paths.skillsDir).toContain('.pi');
      expect(paths.skillsDir).toContain('skills');
      expect(paths.contextFileName).toBe('AGENTS.md');
      expect(paths.launchCommand).toBe('pi');
      expect(paths.supportsMcp).toBe(false);
      expect(paths.supportsHooks).toBe(false);
    });
  });

  describe('getActiveAgents', () => {
    it('returns only Claude when aiAgent is "claude"', async () => {
      writeConfig({ aiAgent: 'claude' });
      const { getActiveAgents } = await loadModule();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('claude');
    });

    it('returns only Pi when aiAgent is "pi"', async () => {
      writeConfig({ aiAgent: 'pi' });
      const { getActiveAgents } = await loadModule();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('pi');
    });

    it('returns all available agents when aiAgent is "both"', async () => {
      writeConfig({ aiAgent: 'both' });
      // Mock all CLIs as available
      execSync.mockImplementation(() => Buffer.from('1.0.0'));
      const { getActiveAgents, resetAgentConfigCache } = await import('./agent-config');
      resetAgentConfigCache();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(5);
      expect(agents.map(a => a.type)).toEqual(['claude', 'pi', 'opencode', 'codex', 'gemini']);
    });

    it('resolves auto to claude when only claude CLI available', async () => {
      writeConfig({ aiAgent: 'auto' });
      execSync.mockImplementation((cmd: string) => {
        if (cmd.toString().includes('claude --version')) return Buffer.from('1.0.0');
        throw new Error('not found');
      });
      const { getActiveAgents, resetAgentConfigCache } = await import('./agent-config');
      resetAgentConfigCache();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('claude');
    });

    it('resolves auto to pi when only pi CLI available', async () => {
      writeConfig({ aiAgent: 'auto' });
      execSync.mockImplementation((cmd: string) => {
        if (cmd.toString().includes('pi --version')) return Buffer.from('1.0.0');
        throw new Error('not found');
      });
      const { getActiveAgents, resetAgentConfigCache } = await import('./agent-config');
      resetAgentConfigCache();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('pi');
    });

    it('resolves auto to both when both CLIs available', async () => {
      writeConfig({ aiAgent: 'auto' });
      execSync.mockImplementation(() => Buffer.from('1.0.0'));
      const { getActiveAgents, resetAgentConfigCache } = await import('./agent-config');
      resetAgentConfigCache();
      const agents = getActiveAgents();
      expect(agents).toHaveLength(5);
      expect(agents.map(a => a.type)).toContain('claude');
      expect(agents.map(a => a.type)).toContain('pi');
      expect(agents.map(a => a.type)).toContain('opencode');
    });
  });

  describe('getPrimaryAgent', () => {
    it('returns Claude when primaryAgent is "claude"', async () => {
      writeConfig({ primaryAgent: 'claude' });
      const { getPrimaryAgent } = await loadModule();
      expect(getPrimaryAgent().type).toBe('claude');
    });

    it('returns Pi when primaryAgent is "pi"', async () => {
      writeConfig({ primaryAgent: 'pi' });
      const { getPrimaryAgent } = await loadModule();
      expect(getPrimaryAgent().type).toBe('pi');
    });

    it('returns an agent when primaryAgent is "auto" (default)', async () => {
      writeConfig({});
      const { getPrimaryAgent } = await loadModule();
      // auto detects installed CLIs — just verify it returns something
      const agent = getPrimaryAgent();
      expect(['claude', 'pi']).toContain(agent.type);
    });
  });

  describe('getSkillsTargetDirs', () => {
    it('returns one dir for single agent', async () => {
      writeConfig({ aiAgent: 'claude' });
      const { getSkillsTargetDirs } = await loadModule();
      const dirs = getSkillsTargetDirs();
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toContain('.claude');
    });

    it('returns two dirs for both agents', async () => {
      writeConfig({ aiAgent: 'both' });
      const { getSkillsTargetDirs } = await loadModule();
      const dirs = getSkillsTargetDirs();
      expect(dirs).toHaveLength(2);
      expect(dirs[0]).toContain('.claude');
      expect(dirs[1]).toContain('.pi');
    });

    it('returns Pi dir only for pi agent', async () => {
      writeConfig({ aiAgent: 'pi' });
      const { getSkillsTargetDirs } = await loadModule();
      const dirs = getSkillsTargetDirs();
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toContain('.pi');
    });
  });

  describe('getContextFileNames', () => {
    it('returns CLAUDE.md for Claude', async () => {
      writeConfig({ aiAgent: 'claude' });
      const { getContextFileNames } = await loadModule();
      expect(getContextFileNames()).toEqual(['CLAUDE.md']);
    });

    it('returns AGENTS.md for Pi', async () => {
      writeConfig({ aiAgent: 'pi' });
      const { getContextFileNames } = await loadModule();
      expect(getContextFileNames()).toEqual(['AGENTS.md']);
    });

    it('returns both file names for both agents', async () => {
      writeConfig({ aiAgent: 'both' });
      const { getContextFileNames } = await loadModule();
      const names = getContextFileNames();
      expect(names).toContain('CLAUDE.md');
      expect(names).toContain('AGENTS.md');
      expect(names).toHaveLength(2);
    });
  });

  describe('getAllKnownContextFileNames', () => {
    it('lists AGENTS.md before CLAUDE.md (per-repo scan priority)', async () => {
      // findContextFilesInDir embeds the FIRST existing candidate per dir.
      // In dual-agent repos CLAUDE.md is often a thin "@AGENTS.md" shim, so
      // AGENTS.md must win to embed the real content, not the pointer.
      const { getAllKnownContextFileNames } = await loadModule();
      const names = getAllKnownContextFileNames();
      expect(names.indexOf('AGENTS.md')).toBeLessThan(names.indexOf('CLAUDE.md'));
    });

    it('still recognizes legacy .claude.md (kept last)', async () => {
      const { getAllKnownContextFileNames } = await loadModule();
      const names = getAllKnownContextFileNames();
      expect(names).toContain('.claude.md');
      expect(names.indexOf('.claude.md')).toBe(names.length - 1);
    });
  });

  describe('getHookTargetFiles', () => {
    it('returns Claude settings for Claude agent', async () => {
      writeConfig({ aiAgent: 'claude' });
      const { getHookTargetFiles } = await loadModule();
      const files = getHookTargetFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('.claude');
    });

    it('returns empty for Pi-only (Pi does not support hooks)', async () => {
      writeConfig({ aiAgent: 'pi' });
      const { getHookTargetFiles } = await loadModule();
      expect(getHookTargetFiles()).toHaveLength(0);
    });

    it('returns only Claude settings for both (Pi has no hooks)', async () => {
      writeConfig({ aiAgent: 'both' });
      const { getHookTargetFiles } = await loadModule();
      const files = getHookTargetFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('.claude');
    });
  });

  describe('getMcpAgents', () => {
    it('returns Claude for "claude" config', async () => {
      writeConfig({ aiAgent: 'claude' });
      const { getMcpAgents } = await loadModule();
      const agents = getMcpAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('claude');
    });

    it('returns empty for Pi-only (Pi has no MCP)', async () => {
      writeConfig({ aiAgent: 'pi' });
      const { getMcpAgents } = await loadModule();
      expect(getMcpAgents()).toHaveLength(0);
    });

    it('returns only Claude for both (Pi has no MCP)', async () => {
      writeConfig({ aiAgent: 'both' });
      const { getMcpAgents } = await loadModule();
      const agents = getMcpAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].type).toBe('claude');
    });
  });

  describe('resumeCommand', () => {
    it('generates correct Claude resume command', async () => {
      const { getAgentPaths } = await loadModule();
      const claude = getAgentPaths('claude');
      expect(claude.resumeCommand('abc-123')).toBe('claude --resume abc-123 --fork-session');
    });

    it('generates correct Pi resume command', async () => {
      const { getAgentPaths } = await loadModule();
      const pi = getAgentPaths('pi');
      expect(pi.resumeCommand('abc-123')).toBe('pi --session abc-123 --fork');
    });
  });
});
