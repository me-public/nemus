import * as fs from 'fs/promises';
import * as path from 'path';
import { GitHubRepo } from '../types';
import { CACHE_DIR } from './config';
import { logInfo, logWarning } from './logger';
import { colorize } from './colors';

const REPOS_CACHE_FILE = path.join(CACHE_DIR, 'repos-cache.json');
const DEFAULT_TTL = 86400000; // 24 hours in milliseconds

interface CacheEntry {
  data: GitHubRepo[];
  timestamp: number;
  ttl: number;
  org?: string;
}

interface CacheOptions {
  ttl?: number;
  force?: boolean;
  org?: string;
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    logWarning('Failed to create cache directory');
  }
}

/**
 * Check if cache is valid (not expired)
 */
function isCacheValid(entry: CacheEntry): boolean {
  const now = Date.now();
  const age = now - entry.timestamp;
  return age < entry.ttl;
}

/**
 * Get cache age in human-readable format
 */
function getCacheAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const ageMinutes = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMinutes / 60);
  const ageDays = Math.floor(ageHours / 24);

  if (ageDays > 0) {
    return `${ageDays} day${ageDays > 1 ? 's' : ''} ago`;
  } else if (ageHours > 0) {
    return `${ageHours} hour${ageHours > 1 ? 's' : ''} ago`;
  } else if (ageMinutes > 0) {
    return `${ageMinutes} minute${ageMinutes > 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

/**
 * Read cached repositories
 */
export async function getCachedRepos(options: CacheOptions = {}): Promise<GitHubRepo[] | null> {
  const { force = false, org } = options;

  if (force) {
    logInfo('Skipping cache (forced refresh)');
    return null;
  }

  try {
    const content = await fs.readFile(REPOS_CACHE_FILE, 'utf-8');
    const entry: CacheEntry = JSON.parse(content);

    if (org && entry.org !== org) {
      logInfo(`Cache is for org "${entry.org || 'unknown'}", but current org is "${org}". Refreshing...`);
      return null;
    }

    if (isCacheValid(entry)) {
      const age = getCacheAge(entry.timestamp);
      logInfo(`Using cached repositories (${colorize(String(entry.data.length), 'cyan')} repos, cached ${age})`);
      return entry.data;
    } else {
      logInfo('Cache expired, fetching fresh data...');
      return null;
    }
  } catch (error) {
    // Cache file doesn't exist or is invalid
    return null;
  }
}

/**
 * Write repositories to cache
 */
export async function setCachedRepos(repos: GitHubRepo[], ttl: number = DEFAULT_TTL, org?: string): Promise<void> {
  try {
    await ensureCacheDir();

    const entry: CacheEntry = {
      data: repos,
      timestamp: Date.now(),
      ttl,
      org,
    };

    await fs.writeFile(REPOS_CACHE_FILE, JSON.stringify(entry, null, 2), 'utf-8');
    logInfo(`Cached ${colorize(String(repos.length), 'cyan')} repositories (TTL: ${Math.floor(ttl / 60000)} minutes)`);
  } catch (error) {
    logWarning('Failed to cache repositories');
  }
}

/**
 * Clear the cache
 */
export async function clearCache(): Promise<void> {
  try {
    await fs.unlink(REPOS_CACHE_FILE);
    logInfo('Cache cleared successfully');
  } catch (error) {
    // Cache file doesn't exist, nothing to clear
    logInfo('No cache to clear');
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ exists: boolean; age?: string; repoCount?: number; size?: number }> {
  try {
    const content = await fs.readFile(REPOS_CACHE_FILE, 'utf-8');
    const entry: CacheEntry = JSON.parse(content);
    const stats = await fs.stat(REPOS_CACHE_FILE);

    return {
      exists: true,
      age: getCacheAge(entry.timestamp),
      repoCount: entry.data.length,
      size: stats.size,
    };
  } catch {
    return { exists: false };
  }
}
