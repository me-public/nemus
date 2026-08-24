import * as fs from 'fs/promises';
import { WorkspaceSuite, SuitesStore } from '../types';
import { CACHE_DIR, SUITES_FILE } from './config';
import { logWarning } from './logger';

const SUITE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    logWarning('Failed to create cache directory');
  }
}

export async function loadSuitesStore(): Promise<SuitesStore> {
  try {
    const content = await fs.readFile(SUITES_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { version: 1, suites: [] };
  }
}

export async function saveSuitesStore(store: SuitesStore): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(SUITES_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function listSuites(): Promise<WorkspaceSuite[]> {
  const store = await loadSuitesStore();
  return store.suites.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSuite(name: string): Promise<WorkspaceSuite | undefined> {
  const store = await loadSuitesStore();
  return store.suites.find(s => s.name === name);
}

export async function saveSuite(suite: WorkspaceSuite): Promise<void> {
  const store = await loadSuitesStore();
  const existingIndex = store.suites.findIndex(s => s.name === suite.name);

  if (existingIndex >= 0) {
    store.suites[existingIndex] = suite;
  } else {
    store.suites.push(suite);
  }

  await saveSuitesStore(store);
}

export async function deleteSuite(name: string): Promise<boolean> {
  const store = await loadSuitesStore();
  const index = store.suites.findIndex(s => s.name === name);

  if (index < 0) {
    return false;
  }

  store.suites.splice(index, 1);
  await saveSuitesStore(store);
  return true;
}

export async function exportSuite(name: string): Promise<SuitesStore | null> {
  const suite = await getSuite(name);
  if (!suite) {
    return null;
  }
  return { version: 1, suites: [suite] };
}

export async function exportAllSuites(): Promise<SuitesStore> {
  const store = await loadSuitesStore();
  return { version: 1, suites: store.suites };
}

export async function importSuites(
  data: SuitesStore,
  overwrite: boolean
): Promise<{ imported: string[]; skipped: string[]; errors: string[] }> {
  const result = { imported: [] as string[], skipped: [] as string[], errors: [] as string[] };
  const store = await loadSuitesStore();

  for (const suite of data.suites) {
    const nameValidation = validateSuiteName(suite.name);
    if (nameValidation !== true) {
      result.errors.push(`${suite.name}: ${nameValidation}`);
      continue;
    }

    if (!Array.isArray(suite.entries)) {
      result.errors.push(`${suite.name}: missing or invalid entries`);
      continue;
    }

    const hasInvalidEntries = suite.entries.some(
      e => !e.repoName || typeof e.repoName !== 'string' || !e.directoryName || typeof e.directoryName !== 'string'
    );
    if (hasInvalidEntries) {
      result.errors.push(`${suite.name}: entries contain invalid repoName or directoryName values`);
      continue;
    }

    const existingIndex = store.suites.findIndex(s => s.name === suite.name);

    if (existingIndex >= 0 && !overwrite) {
      result.skipped.push(suite.name);
      continue;
    }

    if (existingIndex >= 0) {
      store.suites[existingIndex] = suite;
    } else {
      store.suites.push(suite);
    }

    result.imported.push(suite.name);
  }

  await saveSuitesStore(store);
  return result;
}

export function validateSuiteName(name: string): true | string {
  if (!name || name.trim().length === 0) {
    return 'Suite name cannot be empty';
  }

  if (!SUITE_NAME_REGEX.test(name)) {
    return 'Suite name must contain only alphanumeric characters, hyphens, and underscores';
  }

  if (name.length < 2) {
    return 'Suite name must be at least 2 characters long';
  }

  if (name.length > 50) {
    return 'Suite name must be 50 characters or less';
  }

  return true;
}
