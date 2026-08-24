import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CACHE_DIR, getPackageVersion } from './config';

const execFileAsync = promisify(execFile);

const VERSION_CHECK_FILE = path.join(CACHE_DIR, 'last-version-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VersionCheckCache {
  checkedAt: string;
  latestVersion: string;
}

function compareVersions(current: string, latest: string): number {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) < (b[i] || 0)) return -1;
    if ((a[i] || 0) > (b[i] || 0)) return 1;
  }
  return 0;
}

async function loadCache(): Promise<VersionCheckCache | null> {
  try {
    const content = await fs.readFile(VERSION_CHECK_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveCache(cache: VersionCheckCache): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(VERSION_CHECK_FILE, JSON.stringify(cache), 'utf-8');
  } catch {
    // Silently ignore cache write failures
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', 'grove-cli', 'version'], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a newer version is available.
 * Returns upgrade message string if an update is available, null otherwise.
 * Caches the result for 24 hours to avoid spamming npm on every invocation.
 * This is designed to be non-blocking and best-effort — failures are silent.
 */
export async function checkForUpdate(): Promise<string | null> {
  try {
    const currentVersion = getPackageVersion();
    const cache = await loadCache();

    // If we checked recently, use cached result
    if (cache) {
      const elapsed = Date.now() - new Date(cache.checkedAt).getTime();
      if (elapsed < CHECK_INTERVAL_MS) {
        if (compareVersions(currentVersion, cache.latestVersion) < 0) {
          return formatUpdateMessage(currentVersion, cache.latestVersion);
        }
        return null;
      }
    }

    // Fetch latest version from npm (async with timeout)
    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) return null;

    await saveCache({ checkedAt: new Date().toISOString(), latestVersion });

    if (compareVersions(currentVersion, latestVersion) < 0) {
      return formatUpdateMessage(currentVersion, latestVersion);
    }

    return null;
  } catch {
    return null;
  }
}

function formatUpdateMessage(current: string, latest: string): string {
  return `\x1b[33m[grove] Update available: ${current} -> ${latest}. Run: npm install -g grove-cli@latest\x1b[0m`;
}
