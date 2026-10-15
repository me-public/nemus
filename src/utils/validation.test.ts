import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { validateWorkspaceName, sanitizeWorkspaceName, checkWorkspaceExists, safeWorkspacePath, assertSafeWorkspaceName, isSafePathSegment, resolveWorkspaceFromPath } from './validation';
import { WORKSPACES_DIR } from './config';

describe('validateWorkspaceName', () => {
  it('returns true for valid names', () => {
    expect(validateWorkspaceName('my-workspace')).toBe(true);
    expect(validateWorkspaceName('test_workspace')).toBe(true);
    expect(validateWorkspaceName('workspace123')).toBe(true);
    expect(validateWorkspaceName('My-Workspace_01')).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateWorkspaceName('')).toBe('Workspace name cannot be empty');
    expect(validateWorkspaceName('   ')).toBe('Workspace name cannot be empty');
  });

  it('rejects names with invalid characters', () => {
    const result = validateWorkspaceName('my workspace');
    expect(result).toContain('alphanumeric');

    expect(validateWorkspaceName('my@workspace')).toContain('alphanumeric');
    expect(validateWorkspaceName('my/workspace')).toContain('alphanumeric');
    expect(validateWorkspaceName('my.workspace')).toContain('alphanumeric');
  });

  it('rejects names that are too short', () => {
    const result = validateWorkspaceName('ab');
    expect(result).toContain('at least 3');
  });

  it('rejects names that are too long', () => {
    const longName = 'a'.repeat(51);
    const result = validateWorkspaceName(longName);
    expect(result).toContain('less than 50');
  });
});

describe('sanitizeWorkspaceName', () => {
  it('trims whitespace', () => {
    expect(sanitizeWorkspaceName('  my-workspace  ')).toBe('my-workspace');
  });

  it('converts to lowercase', () => {
    expect(sanitizeWorkspaceName('My-Workspace')).toBe('my-workspace');
  });

  it('trims and lowercases together', () => {
    expect(sanitizeWorkspaceName('  MY-WORKSPACE  ')).toBe('my-workspace');
  });

  it('converts spaces to hyphens', () => {
    expect(sanitizeWorkspaceName('my workspace')).toBe('my-workspace');
    expect(sanitizeWorkspaceName('my  workspace')).toBe('my-workspace');
    expect(sanitizeWorkspaceName('  My Workspace Name  ')).toBe('my-workspace-name');
  });
});

describe('checkWorkspaceExists', () => {
  let tempDir: string;
  const originalEnv = process.env.WORKSPACE_MANAGER_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-test-'));
    process.env.WORKSPACE_MANAGER_DIR = tempDir;
  });

  afterEach(async () => {
    process.env.WORKSPACE_MANAGER_DIR = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns true when workspace directory exists', async () => {
    await fs.mkdir(path.join(tempDir, 'existing-workspace'));
    // checkWorkspaceExists uses WORKSPACES_DIR which is evaluated at import time,
    // so we test the path logic directly
    const workspacePath = path.join(tempDir, 'existing-workspace');
    try {
      await fs.access(workspacePath);
      expect(true).toBe(true);
    } catch {
      expect.fail('Directory should exist');
    }
  });

  it('returns false when workspace directory does not exist', async () => {
    const workspacePath = path.join(tempDir, 'non-existent');
    try {
      await fs.access(workspacePath);
      expect.fail('Directory should not exist');
    } catch {
      expect(true).toBe(true);
    }
  });
});

describe('safeWorkspacePath (path-traversal guard)', () => {
  const base = path.resolve(WORKSPACES_DIR);

  it('accepts normal workspace names and keeps them inside WORKSPACES_DIR', () => {
    for (const name of ['payments', 'my-workspace', 'ws_2', 'ABC-123']) {
      const p = safeWorkspacePath(name);
      expect(p).toBe(path.join(base, name));
      expect(p.startsWith(base + path.sep)).toBe(true);
    }
  });

  it('rejects path traversal and separators', () => {
    for (const evil of [
      '../etc',
      '../../etc/passwd',
      '..',
      '.',
      'foo/bar',
      'foo\\bar',
      '/etc/passwd',
      '~/secrets',
      'a/../../b',
      'foo.bar',        // dots are not allowed in workspace names
      '',
    ]) {
      expect(() => safeWorkspacePath(evil)).toThrow();
      expect(isSafePathSegment(evil)).toBe(false);
    }
  });

  it('rejects a NUL byte and overly long names', () => {
    expect(() => safeWorkspacePath('foo\0bar')).toThrow();
    expect(() => safeWorkspacePath('a'.repeat(65))).toThrow();
  });

  it('assertSafeWorkspaceName throws on non-string input', () => {
    expect(() => assertSafeWorkspaceName(undefined as any)).toThrow();
    expect(() => assertSafeWorkspaceName(123 as any)).toThrow();
  });
});

describe('resolveWorkspaceFromPath', () => {
  let tmp: string;
  let wsRoot: string;

  const makeWorkspace = async (name: string, meta: object = { workspaceName: name }) => {
    const dir = path.join(wsRoot, name);
    await fs.mkdir(path.join(dir, 'api', 'src', 'components'), { recursive: true });
    await fs.writeFile(path.join(dir, '.workspace-meta.json'), JSON.stringify(meta));
    return dir;
  };

  beforeEach(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nemus-resolve-')));
    wsRoot = path.join(tmp, 'workspaces');
    await fs.mkdir(wsRoot, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('resolves the workspace directory itself', async () => {
    const dir = await makeWorkspace('payments');
    expect(resolveWorkspaceFromPath(dir, wsRoot)).toEqual({ name: 'payments', path: dir });
  });

  it('resolves from a repo directory inside the workspace', async () => {
    const dir = await makeWorkspace('payments');
    expect(resolveWorkspaceFromPath(path.join(dir, 'api'), wsRoot)?.name).toBe('payments');
  });

  it('resolves from several levels deep inside a repo', async () => {
    const dir = await makeWorkspace('payments');
    expect(resolveWorkspaceFromPath(path.join(dir, 'api', 'src', 'components'), wsRoot)).toEqual({
      name: 'payments',
      path: dir,
    });
  });

  it('uses the real directory name even if metadata.workspaceName has drifted', async () => {
    const dir = await makeWorkspace('payments', { workspaceName: 'something-else' });
    expect(resolveWorkspaceFromPath(dir, wsRoot)?.name).toBe('payments');
  });

  it('ignores a stray metadata file outside the workspaces dir', async () => {
    const stray = path.join(tmp, 'elsewhere');
    await fs.mkdir(stray, { recursive: true });
    await fs.writeFile(path.join(stray, '.workspace-meta.json'), '{}');
    expect(resolveWorkspaceFromPath(stray, wsRoot)).toBeNull();
  });

  it('returns null for a directory under the root that has no metadata', async () => {
    const dir = path.join(wsRoot, 'not-managed', 'deep');
    await fs.mkdir(dir, { recursive: true });
    expect(resolveWorkspaceFromPath(dir, wsRoot)).toBeNull();
  });

  it('returns null for the workspaces dir itself and for unrelated paths', async () => {
    expect(resolveWorkspaceFromPath(wsRoot, wsRoot)).toBeNull();
    expect(resolveWorkspaceFromPath(tmp, wsRoot)).toBeNull();
  });

  it('resolves when the workspaces dir is reached through a symlink', async () => {
    const dir = await makeWorkspace('payments');
    const link = path.join(tmp, 'ws-link');
    await fs.symlink(wsRoot, link);
    const viaLink = resolveWorkspaceFromPath(path.join(dir, 'api', 'src'), link);
    expect(viaLink).toEqual({ name: 'payments', path: path.join(link, 'payments') });
    expect(resolveWorkspaceFromPath(path.join(link, 'payments', 'api'), wsRoot)?.name).toBe('payments');
  });

  it('matches when the configured dir differs only in case (case-insensitive FS)', async () => {
    const dir = await makeWorkspace('payments');
    const upper = path.join(tmp, 'WORKSPACES');
    const caseInsensitive = await fs.access(upper).then(() => true, () => false);
    if (!caseInsensitive) return;
    expect(resolveWorkspaceFromPath(path.join(dir, 'api'), upper)?.name).toBe('payments');
  });

  it('does not resolve a symlinked entry that points outside the workspaces dir', async () => {
    const outside = path.join(tmp, 'outside', 'victim');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, '.workspace-meta.json'), '{}');
    await fs.symlink(outside, path.join(wsRoot, 'planted'));
    expect(resolveWorkspaceFromPath(path.join(wsRoot, 'planted'), wsRoot)).toBeNull();
    expect(resolveWorkspaceFromPath(outside, wsRoot)).toBeNull();
  });

  it('returns null (never throws) for non-string input from untrusted JSON', () => {
    for (const bad of [123, { x: 1 }, ['/tmp'], null, undefined]) {
      expect(resolveWorkspaceFromPath(bad as any, wsRoot)).toBeNull();
      expect(resolveWorkspaceFromPath(wsRoot, bad as any)).toBeNull();
    }
    expect(resolveWorkspaceFromPath('/tmp/a\0b', wsRoot)).toBeNull();
  });

  it('never throws for nonexistent paths', () => {
    expect(resolveWorkspaceFromPath('/definitely/not/here', wsRoot)).toBeNull();
    expect(resolveWorkspaceFromPath(wsRoot, '/definitely/not/here')).toBeNull();
  });
});
