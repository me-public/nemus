import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock github fetcher
const mockFetchAcmeRepos = vi.fn();
vi.mock('../utils/github', () => ({
  fetchOrgRepos: (...args: unknown[]) => mockFetchAcmeRepos(...args),
}));

// Mock clone operations
const mockCloneRepositories = vi.fn();
vi.mock('../utils/git-operations', () => ({
  cloneRepositories: (...args: unknown[]) => mockCloneRepositories(...args),
  reportCloneResults: vi.fn(),
}));

// Mock claude integration
vi.mock('../utils/claude-integration', () => ({
  generateClaudeContext: vi.fn(),
}));

// Stub out other heavy deps
vi.mock('../utils/health-checks', () => ({
  runAllHealthChecks: vi.fn().mockResolvedValue([]),
  calculateHealthScore: vi.fn().mockReturnValue({ status: 'healthy', score: 100 }),
}));

vi.mock('../utils/dependency-analyzer', () => ({
  analyzeDependencies: vi.fn().mockResolvedValue({}),
  detectCircularDependencies: vi.fn().mockReturnValue([]),
}));

vi.mock('../utils/suite', () => ({
  listSuites: vi.fn().mockResolvedValue([]),
}));

const makeRepo = (name: string) => ({
  name,
  url: `https://github.com/acme/${name}`,
  sshUrl: `git@github.com:acme/${name}.git`,
  owner: { login: 'acme' },
  description: '',
  isPrivate: false,
});

describe('handleUpdateWorkspace — suffix logic', () => {
  let tempDir: string;
  let handleUpdateWorkspace: typeof import('./tools').handleUpdateWorkspace;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-update-test-'));
    process.env.WORKSPACE_MANAGER_DIR = tempDir;
    process.env.WORKSPACE_MANAGER_CACHE_DIR = path.join(tempDir, '.cache');

    vi.clearAllMocks();
    vi.resetModules();

    mockFetchAcmeRepos.mockResolvedValue([
      makeRepo('partnerships-api'),
      makeRepo('acme-db'),
      makeRepo('payments-service'),
    ]);

    const mod = await import('./tools');
    handleUpdateWorkspace = mod.handleUpdateWorkspace;
  });

  afterEach(async () => {
    delete process.env.WORKSPACE_MANAGER_DIR;
    delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createWorkspace(name: string, repos: string[]) {
    const wsPath = path.join(tempDir, name);
    await fs.mkdir(wsPath, { recursive: true });
    await fs.writeFile(
      path.join(wsPath, '.workspace-meta.json'),
      JSON.stringify({
        workspaceName: name,
        createdAt: '2024-01-01T00:00:00Z',
        repositories: repos.map(r => ({
          name: r,
          directoryName: r,
          owner: 'acme',
          clonedAt: '2024-01-01T00:00:00Z',
          cloneUrl: `git@github.com:acme/${r}.git`,
          status: 'success',
        })),
      })
    );
  }

  it('adds a new repo without suffix (string input)', async () => {
    await createWorkspace('ws1', ['acme-db']);
    mockCloneRepositories.mockResolvedValue([
      { repo: makeRepo('partnerships-api'), directoryName: 'partnerships-api', status: 'success', clonedAt: '2024-01-01T00:00:00Z' },
    ]);

    const result = await handleUpdateWorkspace('ws1', ['partnerships-api']);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].directoryName).toBe('partnerships-api');
    expect(result.alreadyExists).toBeUndefined();
  });

  it('rejects duplicate repo without suffix', async () => {
    await createWorkspace('ws2', ['partnerships-api']);

    await expect(handleUpdateWorkspace('ws2', ['partnerships-api'])).rejects.toThrow('already in workspace');
  });

  it('allows same repo with suffix', async () => {
    await createWorkspace('ws3', ['partnerships-api']);
    mockCloneRepositories.mockResolvedValue([
      { repo: makeRepo('partnerships-api'), directoryName: 'partnerships-api-v2', status: 'success', clonedAt: '2024-01-01T00:00:00Z' },
    ]);

    const result = await handleUpdateWorkspace('ws3', [
      { name: 'partnerships-api', suffix: 'v2' },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].directoryName).toBe('partnerships-api-v2');
  });

  it('rejects invalid suffix characters', async () => {
    await createWorkspace('ws4', []);

    await expect(
      handleUpdateWorkspace('ws4', [{ name: 'partnerships-api', suffix: 'bad suffix!' }])
    ).rejects.toThrow('Invalid suffix');
  });

  it('prevents duplicate directory names within the same request', async () => {
    await createWorkspace('ws5', []);
    mockCloneRepositories.mockResolvedValue([
      { repo: makeRepo('partnerships-api'), directoryName: 'partnerships-api', status: 'success', clonedAt: '2024-01-01T00:00:00Z' },
    ]);

    // First is a plain string, second has the same effective name
    const result = await handleUpdateWorkspace('ws5', [
      'partnerships-api',
      { name: 'partnerships-api', suffix: '' },
    ]);

    // The suffix '' is invalid per the regex check — but actually empty suffix means
    // no suffix. Let's verify: typeof '' with the object form means suffix is empty string
    // The code: `suffix ? \`...\` : found.name` — empty string is falsy, so directoryName = found.name
    // Then existingDirectoryNames check catches the dup
    // But actually suffix validation: `suffix && !/regex/.test(suffix)` — empty string is falsy, skips validation
    // So it should be caught by the alreadyExists check
    expect(result.alreadyExists).toContain('partnerships-api');
    expect(result.added).toHaveLength(1);
  });

  it('mixes string and object inputs correctly', async () => {
    await createWorkspace('ws6', ['acme-db']);
    mockCloneRepositories.mockResolvedValue([
      { repo: makeRepo('partnerships-api'), directoryName: 'partnerships-api', status: 'success', clonedAt: '2024-01-01T00:00:00Z' },
      { repo: makeRepo('acme-db'), directoryName: 'acme-db-hotfix', status: 'success', clonedAt: '2024-01-01T00:00:00Z' },
    ]);

    const result = await handleUpdateWorkspace('ws6', [
      'partnerships-api',
      { name: 'acme-db', suffix: 'hotfix' },
    ]);

    expect(result.added).toHaveLength(2);
    expect(result.added.map(a => a.directoryName)).toContain('partnerships-api');
    expect(result.added.map(a => a.directoryName)).toContain('acme-db-hotfix');
  });

  it('reports not-found repos', async () => {
    await createWorkspace('ws7', []);

    await expect(
      handleUpdateWorkspace('ws7', ['non-existent-repo'])
    ).rejects.toThrow('not found');
  });

  it('throws on empty workspace name', async () => {
    await expect(handleUpdateWorkspace('', ['partnerships-api'])).rejects.toThrow('Workspace name is required');
  });

  it('throws on empty repos array', async () => {
    await expect(handleUpdateWorkspace('ws', [])).rejects.toThrow('At least one repository name is required');
  });

  it('throws for non-existent workspace', async () => {
    await expect(handleUpdateWorkspace('does-not-exist', ['partnerships-api'])).rejects.toThrow('Workspace not found');
  });
});
