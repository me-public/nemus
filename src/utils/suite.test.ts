import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('validateSuiteName', () => {
  let validateSuiteName: typeof import('./suite').validateSuiteName;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./suite');
    validateSuiteName = mod.validateSuiteName;
  });

  it('returns true for valid names', () => {
    expect(validateSuiteName('my-suite')).toBe(true);
    expect(validateSuiteName('test_suite')).toBe(true);
    expect(validateSuiteName('suite123')).toBe(true);
    expect(validateSuiteName('ab')).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateSuiteName('')).toContain('empty');
    expect(validateSuiteName('   ')).toContain('empty');
  });

  it('rejects names with invalid characters', () => {
    expect(validateSuiteName('my suite')).toContain('alphanumeric');
    expect(validateSuiteName('my@suite')).toContain('alphanumeric');
    expect(validateSuiteName('my.suite')).toContain('alphanumeric');
  });

  it('rejects names that are too short', () => {
    expect(validateSuiteName('a')).toContain('at least 2');
  });

  it('rejects names that are too long', () => {
    const longName = 'a'.repeat(51);
    expect(validateSuiteName(longName)).toContain('50');
  });
});

describe('suite CRUD operations', () => {
  let tempDir: string;
  let saveSuite: typeof import('./suite').saveSuite;
  let getSuite: typeof import('./suite').getSuite;
  let listSuites: typeof import('./suite').listSuites;
  let deleteSuite: typeof import('./suite').deleteSuite;
  let exportSuite: typeof import('./suite').exportSuite;
  let exportAllSuites: typeof import('./suite').exportAllSuites;
  let importSuites: typeof import('./suite').importSuites;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-suite-test-'));
    process.env.WORKSPACE_MANAGER_CACHE_DIR = tempDir;

    vi.resetModules();
    const mod = await import('./suite');
    saveSuite = mod.saveSuite;
    getSuite = mod.getSuite;
    listSuites = mod.listSuites;
    deleteSuite = mod.deleteSuite;
    exportSuite = mod.exportSuite;
    exportAllSuites = mod.exportAllSuites;
    importSuites = mod.importSuites;
  });

  afterEach(async () => {
    delete process.env.WORKSPACE_MANAGER_CACHE_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('saveSuite creates and getSuite retrieves a suite', async () => {
    const suite = {
      name: 'test-suite',
      description: 'A test suite',
      entries: [{ repoName: 'repo1', directoryName: 'repo1' }],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    await saveSuite(suite);
    const retrieved = await getSuite('test-suite');

    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('test-suite');
    expect(retrieved!.description).toBe('A test suite');
    expect(retrieved!.entries).toHaveLength(1);
  });

  it('listSuites returns suites sorted by name', async () => {
    await saveSuite({
      name: 'z-suite',
      description: '',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    await saveSuite({
      name: 'a-suite',
      description: '',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const suites = await listSuites();
    expect(suites).toHaveLength(2);
    expect(suites[0].name).toBe('a-suite');
    expect(suites[1].name).toBe('z-suite');
  });

  it('saveSuite upserts existing suites', async () => {
    const suite = {
      name: 'test-suite',
      description: 'original',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    await saveSuite(suite);
    await saveSuite({ ...suite, description: 'updated' });

    const suites = await listSuites();
    expect(suites).toHaveLength(1);
    expect(suites[0].description).toBe('updated');
  });

  it('deleteSuite removes an existing suite', async () => {
    await saveSuite({
      name: 'to-delete',
      description: '',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const result = await deleteSuite('to-delete');
    expect(result).toBe(true);

    const retrieved = await getSuite('to-delete');
    expect(retrieved).toBeUndefined();
  });

  it('deleteSuite returns false for non-existent suite', async () => {
    const result = await deleteSuite('non-existent');
    expect(result).toBe(false);
  });

  it('exportSuite exports a single suite', async () => {
    await saveSuite({
      name: 'export-me',
      description: 'test',
      entries: [{ repoName: 'r1', directoryName: 'r1' }],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const exported = await exportSuite('export-me');
    expect(exported).toBeDefined();
    expect(exported!.version).toBe(1);
    expect(exported!.suites).toHaveLength(1);
    expect(exported!.suites[0].name).toBe('export-me');
  });

  it('exportAllSuites exports all suites', async () => {
    await saveSuite({
      name: 'suite-a',
      description: '',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    await saveSuite({
      name: 'suite-b',
      description: '',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const exported = await exportAllSuites();
    expect(exported.version).toBe(1);
    expect(exported.suites).toHaveLength(2);
  });

  it('importSuites imports with overwrite=true', async () => {
    await saveSuite({
      name: 'existing',
      description: 'old',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const result = await importSuites({
      version: 1,
      suites: [{
        name: 'existing',
        description: 'new',
        entries: [{ repoName: 'r', directoryName: 'r' }],
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      }],
    }, true);

    expect(result.imported).toContain('existing');
    expect(result.skipped).toHaveLength(0);

    const retrieved = await getSuite('existing');
    expect(retrieved!.description).toBe('new');
  });

  it('importSuites skips with overwrite=false', async () => {
    await saveSuite({
      name: 'existing',
      description: 'old',
      entries: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const result = await importSuites({
      version: 1,
      suites: [{
        name: 'existing',
        description: 'new',
        entries: [],
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      }],
    }, false);

    expect(result.skipped).toContain('existing');

    const retrieved = await getSuite('existing');
    expect(retrieved!.description).toBe('old');
  });

  it('importSuites reports validation errors', async () => {
    const result = await importSuites({
      version: 1,
      suites: [{
        name: '',
        description: '',
        entries: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }],
    }, true);

    expect(result.errors).toHaveLength(1);
    expect(result.imported).toHaveLength(0);
  });
});
