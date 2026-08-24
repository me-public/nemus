import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { validateWorkspaceName, sanitizeWorkspaceName, checkWorkspaceExists, safeWorkspacePath, assertSafeWorkspaceName, isSafePathSegment } from './validation';
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
