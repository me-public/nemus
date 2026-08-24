import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const REPO_META = (name: string, status: 'success' | 'failed' = 'success') => ({
  name,
  directoryName: name,
  owner: 'acme',
  clonedAt: '2024-01-01T00:00:00Z',
  cloneUrl: `git@github.com:acme/${name}.git`,
  status,
});

const writeMetadata = async (wsPath: string, workspaceName: string, repos: ReturnType<typeof REPO_META>[]) => {
  await fs.writeFile(
    path.join(wsPath, '.workspace-meta.json'),
    JSON.stringify({
      workspaceName,
      createdAt: '2024-01-01T00:00:00Z',
      repositories: repos,
    })
  );
};

describe('MCP tool handlers', () => {
  let tempDir: string;
  let handleListWorkspaces: typeof import('./tools').handleListWorkspaces;
  let handleWorkspaceStatus: typeof import('./tools').handleWorkspaceStatus;
  let handleWorkspaceDiff: typeof import('./tools').handleWorkspaceDiff;
  let handleWorkspaceInfo: typeof import('./tools').handleWorkspaceInfo;
  let handleListSuites: typeof import('./tools').handleListSuites;
  let handleRunCommand: typeof import('./tools').handleRunCommand;
  let handleDeleteWorkspace: typeof import('./tools').handleDeleteWorkspace;
  let handleRemoveRepo: typeof import('./tools').handleRemoveRepo;
  let handleWorkspaceDoctor: typeof import('./tools').handleWorkspaceDoctor;
  let handleAnalyzeDeps: typeof import('./tools').handleAnalyzeDeps;
  let handleBranchCreate: typeof import('./tools').handleBranchCreate;
  let handleSwitchBranch: typeof import('./tools').handleSwitchBranch;
  let handleWorkspaceCleanup: typeof import('./tools').handleWorkspaceCleanup;
  let handleSearchRepos: typeof import('./tools').handleSearchRepos;
  let handleListOrgRepos: typeof import('./tools').handleListOrgRepos;
  let handleUpdateCache: typeof import('./tools').handleUpdateCache;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-mcp-test-'));
    process.env.WORKSPACE_MANAGER_DIR = tempDir;
    process.env.WORKSPACE_MANAGER_CACHE_DIR = path.join(tempDir, '.cache');

    vi.resetModules();
    const mod = await import('./tools');
    handleListWorkspaces = mod.handleListWorkspaces;
    handleWorkspaceStatus = mod.handleWorkspaceStatus;
    handleWorkspaceDiff = mod.handleWorkspaceDiff;
    handleWorkspaceInfo = mod.handleWorkspaceInfo;
    handleListSuites = mod.handleListSuites;
    handleRunCommand = mod.handleRunCommand;
    handleDeleteWorkspace = mod.handleDeleteWorkspace;
    handleRemoveRepo = mod.handleRemoveRepo;
    handleWorkspaceDoctor = mod.handleWorkspaceDoctor;
    handleAnalyzeDeps = mod.handleAnalyzeDeps;
    handleBranchCreate = mod.handleBranchCreate;
    handleSwitchBranch = mod.handleSwitchBranch;
    handleWorkspaceCleanup = mod.handleWorkspaceCleanup;
    handleSearchRepos = mod.handleSearchRepos;
    handleListOrgRepos = mod.handleListOrgRepos;
    handleUpdateCache = mod.handleUpdateCache;
  });

  afterEach(async () => {
    delete process.env.WORKSPACE_MANAGER_DIR;
    delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('handleListWorkspaces', () => {
    it('returns empty array when no workspaces exist', async () => {
      const result = await handleListWorkspaces();
      expect(result).toEqual([]);
    });

    it('returns workspaces with metadata', async () => {
      const wsPath = path.join(tempDir, 'test-workspace');
      await fs.mkdir(wsPath, { recursive: true });
      await writeMetadata(wsPath, 'test-workspace', [
        REPO_META('repo1'),
        REPO_META('repo2', 'failed'),
      ]);

      const result = await handleListWorkspaces();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-workspace');
      expect(result[0].repoCount).toBe(1); // only successful repos
      expect(result[0].createdAt).toBe('2024-01-01T00:00:00Z');
    });
  });

  describe('handleWorkspaceInfo', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleWorkspaceInfo('non-existent')).rejects.toThrow('Workspace not found');
    });

    it('returns full metadata for existing workspace', async () => {
      const wsPath = path.join(tempDir, 'my-ws');
      await fs.mkdir(wsPath, { recursive: true });
      await writeMetadata(wsPath, 'my-ws', [REPO_META('repo1')]);

      const result = await handleWorkspaceInfo('my-ws');
      expect(result.workspaceName).toBe('my-ws');
      expect(result.repositories).toHaveLength(1);
      expect(result.path).toBe(wsPath);
    });
  });

  describe('handleWorkspaceStatus', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleWorkspaceStatus('non-existent')).rejects.toThrow('Workspace not found');
    });
  });

  describe('handleWorkspaceDiff', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleWorkspaceDiff('non-existent')).rejects.toThrow('Workspace not found');
    });

    it('returns diff summary for workspace with repos', async () => {
      const wsPath = path.join(tempDir, 'diff-ws');
      await fs.mkdir(wsPath, { recursive: true });

      // Create a repo directory (not a real git repo, so diffs will be empty/error)
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });

      await writeMetadata(wsPath, 'diff-ws', [REPO_META('repo1')]);

      const result = await handleWorkspaceDiff('diff-ws');
      expect(result.workspace).toBe('diff-ws');
      expect(result.diffs).toHaveLength(1);
      expect(result.summary).toBeDefined();
      expect(result.summary.totalStaged).toBe(0);
      expect(result.summary.totalUnstaged).toBe(0);
    });
  });

  describe('handleRunCommand', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleRunCommand('non-existent', 'echo hello')).rejects.toThrow('Workspace not found');
    });

    it('runs command across repos', async () => {
      const wsPath = path.join(tempDir, 'run-ws');
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });

      await writeMetadata(wsPath, 'run-ws', [REPO_META('repo1')]);

      const result = await handleRunCommand('run-ws', 'echo hello');
      expect(result.workspace).toBe('run-ws');
      expect(result.command).toBe('echo hello');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('success');
      expect(result.results[0].stdout).toBe('hello');
      expect(result.summary.successful).toBe(1);
      expect(result.summary.failed).toBe(0);
    });
  });

  describe('handleUpdateCache', () => {
    it('returns repo count and confirmation message', async () => {
      const mockRepos = [
        { name: 'repo1', owner: { login: 'acme' }, sshUrl: 'git@github.com:acme/repo1.git' },
        { name: 'repo2', owner: { login: 'acme' }, sshUrl: 'git@github.com:acme/repo2.git' },
        { name: 'repo3', owner: { login: 'acme' }, sshUrl: 'git@github.com:acme/repo3.git' },
      ];

      vi.doMock('../utils/github', () => ({
        fetchOrgRepos: vi.fn().mockResolvedValue(mockRepos),
      }));

      vi.resetModules();
      const mod = await import('./tools');
      const result = await mod.handleUpdateCache();

      expect(result.repos).toBe(3);
      expect(result.message).toBe('Cache updated with 3 repositories');
    });

    it('calls fetchOrgRepos with forceRefresh true', async () => {
      const mockFetch = vi.fn().mockResolvedValue([]);

      vi.doMock('../utils/github', () => ({
        fetchOrgRepos: mockFetch,
      }));

      vi.resetModules();
      const mod = await import('./tools');
      await mod.handleUpdateCache();

      expect(mockFetch).toHaveBeenCalledWith({ forceRefresh: true });
    });
  });

  describe('handleListSuites', () => {
    it('returns empty array when no suites exist', async () => {
      const result = await handleListSuites();
      expect(result).toEqual([]);
    });

    it('returns suites with summary info', async () => {
      const cacheDir = path.join(tempDir, '.cache');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(
        path.join(cacheDir, 'suites.json'),
        JSON.stringify({
          version: 1,
          suites: [
            {
              name: 'test-suite',
              description: 'A test suite',
              entries: [
                { repoName: 'repo1', directoryName: 'repo1' },
                { repoName: 'repo2', directoryName: 'repo2' },
              ],
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              postCloneHooks: [{ commands: ['npm install'] }],
            },
          ],
        })
      );

      const result = await handleListSuites();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-suite');
      expect(result[0].repoCount).toBe(2);
      expect(result[0].hasHooks).toBe(true);
    });
  });

  describe('handleDeleteWorkspace', () => {
    it('throws for non-existent workspace (single)', async () => {
      await expect(handleDeleteWorkspace('non-existent')).rejects.toThrow('Workspace directory not found');
    });

    it('deletes an existing workspace with metadata', async () => {
      const wsPath = path.join(tempDir, 'delete-me');
      await fs.mkdir(wsPath, { recursive: true });
      await writeMetadata(wsPath, 'delete-me', [REPO_META('repo1')]);
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });

      const result = await handleDeleteWorkspace('delete-me');
      expect(result.deleted).toBe('delete-me');
      expect(result.path).toBe(wsPath);

      await expect(fs.access(wsPath)).rejects.toThrow();
    });

    it('deletes a workspace without metadata (empty workspace)', async () => {
      const wsPath = path.join(tempDir, 'empty-ws');
      await fs.mkdir(wsPath, { recursive: true });

      const result = await handleDeleteWorkspace('empty-ws');
      expect(result.deleted).toBe('empty-ws');

      await expect(fs.access(wsPath)).rejects.toThrow();
    });

    it('deletes multiple workspaces at once', async () => {
      const ws1 = path.join(tempDir, 'ws-a');
      const ws2 = path.join(tempDir, 'ws-b');
      await fs.mkdir(ws1, { recursive: true });
      await fs.mkdir(ws2, { recursive: true });

      const result = await handleDeleteWorkspace(['ws-a', 'ws-b']) as any;
      expect(result.results).toHaveLength(2);
      expect(result.results[0].deleted).toBe(true);
      expect(result.results[1].deleted).toBe(true);

      await expect(fs.access(ws1)).rejects.toThrow();
      await expect(fs.access(ws2)).rejects.toThrow();
    });

    it('reports errors per workspace in multi-delete', async () => {
      const ws1 = path.join(tempDir, 'ws-exists');
      await fs.mkdir(ws1, { recursive: true });

      const result = await handleDeleteWorkspace(['ws-exists', 'ws-missing']) as any;
      expect(result.results).toHaveLength(2);
      expect(result.results[0].deleted).toBe(true);
      expect(result.results[1].deleted).toBe(false);
      expect(result.results[1].error).toContain('not found');
    });
  });

  describe('handleRemoveRepo', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleRemoveRepo('non-existent', 'repo1')).rejects.toThrow('Workspace not found');
    });

    it('throws for non-existent repo in workspace', async () => {
      const wsPath = path.join(tempDir, 'remove-ws');
      await fs.mkdir(wsPath, { recursive: true });
      await writeMetadata(wsPath, 'remove-ws', [REPO_META('repo1')]);

      await expect(handleRemoveRepo('remove-ws', 'nonexistent')).rejects.toThrow('Repository not found');
    });

    it('removes a repo from workspace', async () => {
      const wsPath = path.join(tempDir, 'remove-ws');
      await fs.mkdir(wsPath, { recursive: true });
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });
      await fs.mkdir(path.join(wsPath, 'repo2'), { recursive: true });
      await writeMetadata(wsPath, 'remove-ws', [REPO_META('repo1'), REPO_META('repo2')]);

      const result = await handleRemoveRepo('remove-ws', 'repo1');
      expect(result.removed).toBe('repo1');
      expect(result.workspace).toBe('remove-ws');
      expect(result.remainingRepos).toBe(1);

      // Verify repo directory is removed
      await expect(fs.access(path.join(wsPath, 'repo1'))).rejects.toThrow();

      // Verify metadata is updated
      const metadata = JSON.parse(await fs.readFile(path.join(wsPath, '.workspace-meta.json'), 'utf-8'));
      expect(metadata.repositories).toHaveLength(1);
      expect(metadata.repositories[0].name).toBe('repo2');
    });
  });

  describe('handleWorkspaceDoctor', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleWorkspaceDoctor('non-existent')).rejects.toThrow('Workspace not found');
    });

    it('returns health checks and score', async () => {
      const wsPath = path.join(tempDir, 'doctor-ws');
      await fs.mkdir(wsPath, { recursive: true });
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });
      await writeMetadata(wsPath, 'doctor-ws', [REPO_META('repo1')]);

      const result = await handleWorkspaceDoctor('doctor-ws');
      expect(result.workspace).toBe('doctor-ws');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
      for (const check of result.checks) {
        expect(check).toHaveProperty('category');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('message');
      }
    });
  });

  describe('handleAnalyzeDeps', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleAnalyzeDeps('non-existent')).rejects.toThrow('Workspace not found');
    });

    it('returns dependency analysis', async () => {
      const wsPath = path.join(tempDir, 'deps-ws');
      await fs.mkdir(wsPath, { recursive: true });
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });
      await fs.mkdir(path.join(wsPath, 'repo2'), { recursive: true });

      // Create a package.json with a dependency on repo2
      await fs.writeFile(
        path.join(wsPath, 'repo1', 'package.json'),
        JSON.stringify({
          name: 'repo1',
          dependencies: { '@acme/repo2': '^1.0.0' },
        })
      );
      await fs.writeFile(
        path.join(wsPath, 'repo2', 'package.json'),
        JSON.stringify({ name: 'repo2' })
      );

      await writeMetadata(wsPath, 'deps-ws', [REPO_META('repo1'), REPO_META('repo2')]);

      const result = await handleAnalyzeDeps('deps-ws');
      expect(result.workspace).toBe('deps-ws');
      expect(result.analyses).toBeDefined();
      expect(result.analyses.repo1).toBeDefined();
      expect(result.analyses.repo2).toBeDefined();
      expect(Array.isArray(result.circularDependencies)).toBe(true);
    });
  });

  describe('handleBranchCreate', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleBranchCreate('non-existent', 'feature/test')).rejects.toThrow('Workspace not found');
    });

    it('attempts to create branch across repos', async () => {
      const wsPath = path.join(tempDir, 'branch-ws');
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });
      await writeMetadata(wsPath, 'branch-ws', [REPO_META('repo1')]);

      // repo1 is not a git repo, so branch creation will fail
      const result = await handleBranchCreate('branch-ws', 'feature/test');
      expect(result.workspace).toBe('branch-ws');
      expect(result.branchName).toBe('feature/test');
      expect(result.results).toHaveLength(1);
      expect(result.summary).toBeDefined();
    });
  });

  describe('handleSwitchBranch', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleSwitchBranch('non-existent', 'main')).rejects.toThrow('Workspace not found');
    });

    it('attempts to switch branches across repos', async () => {
      const wsPath = path.join(tempDir, 'switch-ws');
      await fs.mkdir(path.join(wsPath, 'repo1'), { recursive: true });
      await writeMetadata(wsPath, 'switch-ws', [REPO_META('repo1')]);

      // repo1 is not a git repo, so switch will be skipped
      const result = await handleSwitchBranch('switch-ws', 'main');
      expect(result.workspace).toBe('switch-ws');
      expect(result.branch).toBe('main');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('skipped');
      expect(result.summary.skipped).toBe(1);
    });
  });

  describe('handleWorkspaceCleanup', () => {
    it('throws for non-existent workspace', async () => {
      await expect(handleWorkspaceCleanup('non-existent')).rejects.toThrow('Workspace not found');
    });

    it('cleans up workspace repos', async () => {
      const wsPath = path.join(tempDir, 'cleanup-ws');
      const repoPath = path.join(wsPath, 'repo1');
      await fs.mkdir(repoPath, { recursive: true });

      // Create node_modules and dist directories
      await fs.mkdir(path.join(repoPath, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(repoPath, 'node_modules', 'dummy.js'), 'module.exports = {}');
      await fs.mkdir(path.join(repoPath, 'dist'), { recursive: true });
      await fs.writeFile(path.join(repoPath, 'dist', 'index.js'), 'console.log("built")');

      await writeMetadata(wsPath, 'cleanup-ws', [REPO_META('repo1')]);

      const result = await handleWorkspaceCleanup('cleanup-ws');
      expect(result.workspace).toBe('cleanup-ws');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].repo).toBe('repo1');
      expect(result.results[0].nodeModules).toBeDefined();
      expect(result.results[0].buildArtifacts).toBeDefined();
      expect(result.totalSpaceFreed).toBeDefined();

      // Verify node_modules and dist are removed
      await expect(fs.access(path.join(repoPath, 'node_modules'))).rejects.toThrow();
      await expect(fs.access(path.join(repoPath, 'dist'))).rejects.toThrow();
    });

    it('respects includeNodeModules=false flag', async () => {
      const wsPath = path.join(tempDir, 'cleanup-ws2');
      const repoPath = path.join(wsPath, 'repo1');
      await fs.mkdir(path.join(repoPath, 'node_modules'), { recursive: true });
      await writeMetadata(wsPath, 'cleanup-ws2', [REPO_META('repo1')]);

      const result = await handleWorkspaceCleanup('cleanup-ws2', false, true);
      expect(result.results[0].nodeModules).toBeUndefined();
      expect(result.results[0].buildArtifacts).toBeDefined();
    });
  });

  describe('handleSearchRepos', () => {
    it('returns search results from GitHub repos', async () => {
      // Mock fetchOrgRepos to avoid real API calls
      vi.resetModules();
      vi.doMock('../utils/github', () => ({
        fetchOrgRepos: vi.fn().mockResolvedValue([
          { name: 'partnerships-api', description: 'API for partnerships', url: 'https://github.com/acme/partnerships-api', sshUrl: 'git@github.com:acme/partnerships-api.git', owner: { login: 'acme' }, isPrivate: true },
          { name: 'acme-db', description: 'Database layer', url: 'https://github.com/acme/acme-db', sshUrl: 'git@github.com:acme/acme-db.git', owner: { login: 'acme' }, isPrivate: true },
          { name: 'web-app', description: 'Main web application', url: 'https://github.com/acme/web-app', sshUrl: 'git@github.com:acme/web-app.git', owner: { login: 'acme' }, isPrivate: false },
        ]),
      }));

      const mod = await import('./tools');
      const result = await mod.handleSearchRepos('partner');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('partnerships-api');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('url');
      expect(result[0]).toHaveProperty('isPrivate');
    });

    it('respects limit parameter', async () => {
      vi.resetModules();
      vi.doMock('../utils/github', () => ({
        fetchOrgRepos: vi.fn().mockResolvedValue([
          { name: 'repo-a', description: 'A', url: 'u1', sshUrl: 's1', owner: { login: 'acme' }, isPrivate: false },
          { name: 'repo-ab', description: 'AB', url: 'u2', sshUrl: 's2', owner: { login: 'acme' }, isPrivate: false },
          { name: 'repo-abc', description: 'ABC', url: 'u3', sshUrl: 's3', owner: { login: 'acme' }, isPrivate: false },
        ]),
      }));

      const mod = await import('./tools');
      const result = await mod.handleSearchRepos('repo', 1);
      expect(result).toHaveLength(1);
    });
  });

  describe('handleListOrgRepos', () => {
    it('returns all org repos', async () => {
      vi.resetModules();
      vi.doMock('../utils/github', () => ({
        fetchOrgRepos: vi.fn().mockResolvedValue([
          { name: 'repo1', description: 'First', url: 'u1', sshUrl: 's1', owner: { login: 'acme' }, isPrivate: true },
          { name: 'repo2', description: 'Second', url: 'u2', sshUrl: 's2', owner: { login: 'acme' }, isPrivate: false },
        ]),
      }));

      const mod = await import('./tools');
      const result = await mod.handleListOrgRepos();
      expect(result.repos).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.repos[0]).toHaveProperty('name');
      expect(result.repos[0]).toHaveProperty('description');
      expect(result.repos[0]).toHaveProperty('url');
      expect(result.repos[0]).toHaveProperty('isPrivate');
    });
  });
});
