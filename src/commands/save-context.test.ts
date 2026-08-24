import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('save-context', () => {
  let tempDir: string;
  let handleSaveContext: typeof import('../mcp/tools').handleSaveContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-save-ctx-'));
    process.env.WORKSPACE_MANAGER_DIR = tempDir;
    process.env.WORKSPACE_MANAGER_CACHE_DIR = path.join(tempDir, '.cache');
    vi.resetModules();
    const mod = await import('../mcp/tools');
    handleSaveContext = mod.handleSaveContext;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.WORKSPACE_MANAGER_DIR;
    delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
  });

  async function createWorkspace(name: string, opts?: { prompt?: string }) {
    const wsPath = path.join(tempDir, name);
    await fs.mkdir(wsPath, { recursive: true });
    await fs.writeFile(path.join(wsPath, '.workspace-meta.json'), JSON.stringify({
      workspaceName: name,
      createdAt: '2024-01-01T00:00:00Z',
      repositories: [],
      ...(opts?.prompt ? { prompt: opts.prompt } : {}),
    }));
    return wsPath;
  }

  describe('handleSaveContext (MCP tool)', () => {
    it('creates CONTEXT.md with content', async () => {
      const wsPath = await createWorkspace('my-ws');
      const result = await handleSaveContext('my-ws', 'Completed auth refactor');
      expect(result.saved).toBe(true);
      expect(result.workspace).toBe('my-ws');

      const content = await fs.readFile(path.join(wsPath, 'CONTEXT.md'), 'utf-8');
      expect(content).toContain('Completed auth refactor');
      expect(content).toContain('Workspace Context: my-ws');
    });

    it('replaces content by default', async () => {
      const wsPath = await createWorkspace('my-ws');
      await handleSaveContext('my-ws', 'First version');
      await handleSaveContext('my-ws', 'Second version');

      const content = await fs.readFile(path.join(wsPath, 'CONTEXT.md'), 'utf-8');
      expect(content).toContain('Second version');
      expect(content).not.toContain('First version');
    });

    it('appends when append=true', async () => {
      const wsPath = await createWorkspace('my-ws');
      await handleSaveContext('my-ws', 'First version');
      await handleSaveContext('my-ws', 'Additional notes', true);

      const content = await fs.readFile(path.join(wsPath, 'CONTEXT.md'), 'utf-8');
      expect(content).toContain('First version');
      expect(content).toContain('Additional notes');
      expect(content).toContain('---'); // separator
    });

    it('creates fresh file when appending to non-existent', async () => {
      const wsPath = await createWorkspace('my-ws');
      await handleSaveContext('my-ws', 'Fresh content', true);

      const content = await fs.readFile(path.join(wsPath, 'CONTEXT.md'), 'utf-8');
      expect(content).toContain('Fresh content');
      expect(content).toContain('Workspace Context: my-ws');
    });

    it('throws for non-existent workspace', async () => {
      await expect(handleSaveContext('nope', 'content')).rejects.toThrow('Workspace not found');
    });

    it('throws for empty content', async () => {
      await createWorkspace('my-ws');
      await expect(handleSaveContext('my-ws', '')).rejects.toThrow('Content is required');
    });

    it('throws for empty workspace name', async () => {
      await expect(handleSaveContext('', 'content')).rejects.toThrow('Workspace name is required');
    });
  });
});

describe('createMetadata with prompt', () => {
  it('includes prompt in metadata when provided', async () => {
    vi.resetModules();
    process.env.WORKSPACE_MANAGER_DIR = '/tmp/test-ws';
    const { createMetadata } = await import('../utils/workspace-meta');

    const metadata = createMetadata('test-ws', [], { prompt: 'build a payment service' });
    expect(metadata.prompt).toBe('build a payment service');
    expect(metadata.workspaceName).toBe('test-ws');
  });

  it('omits prompt field when not provided', async () => {
    vi.resetModules();
    process.env.WORKSPACE_MANAGER_DIR = '/tmp/test-ws';
    const { createMetadata } = await import('../utils/workspace-meta');

    const metadata = createMetadata('test-ws', []);
    expect(metadata.prompt).toBeUndefined();
  });
});
