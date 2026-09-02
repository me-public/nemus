#!/usr/bin/env ts-node

import { clearCache, getCacheStats } from '../../utils/cache';
import { fetchOrgRepos, verifyGhAuth, displayAuthInstructions } from '../../utils/github';
import { logInfo, logSuccess, logError } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { confirm, select } from '../../utils/prompt';
import * as fuzzy from 'fuzzy';

export async function cacheInfo() {
  const stats = await getCacheStats();

  if (stats.exists) {
    console.log('\n' + colorize('Cache Information:', 'cyan'));
    console.log(`  Status: ${colorize('Active', 'green')}`);
    console.log(`  Repositories: ${colorize(String(stats.repoCount), 'cyan')}`);
    console.log(`  Last updated: ${stats.age}`);
    console.log(`  Cache size: ${colorize(String(Math.round((stats.size || 0) / 1024)) + ' KB', 'yellow')}`);
    console.log(`  Location: ${colorize('~/.nemus/repos-cache.json', 'gray')}`);
  } else {
    console.log('\n' + colorize('Cache Status:', 'yellow'));
    console.log('  No cache found. Cache will be created on next repository fetch.\n');
  }
}

export async function cacheRefresh() {
  const isAuthenticated = await verifyGhAuth();
  if (!isAuthenticated) {
    logError('GitHub CLI is not authenticated');
    displayAuthInstructions();
    process.exit(1);
  }

  logInfo('Forcing cache refresh...');
  const repos = await fetchOrgRepos({ forceRefresh: true });
  logSuccess(`Cache refreshed with ${colorize(String(repos.length), 'cyan')} repositories`);
}

export async function cacheClear() {
  await clearCache();
  logSuccess('Cache cleared successfully');
}

export async function cacheSearch(query: string, limit: number = 20) {
  if (!query || query.trim().length === 0) {
    logError('Usage: w cache search <query>');
    process.exit(1);
  }

  const allRepos = await fetchOrgRepos();
  const results = fuzzy.filter(query, allRepos, {
    extract: (repo: typeof allRepos[0]) => `${repo.name} ${repo.description || ''}`,
  });

  const matches = results.slice(0, limit);

  if (matches.length === 0) {
    logInfo(`No repositories matching '${query}'`);
    return;
  }

  console.log('\n' + colorize(`Search results for "${query}" (${matches.length} matches):`, 'cyan') + '\n');
  for (const match of matches) {
    const repo = match.original;
    const visibility = repo.isPrivate ? colorize('private', 'yellow') : colorize('public', 'green');
    console.log(`  ${colorize(repo.name, 'bright')} [${visibility}]`);
    if (repo.description) {
      console.log(`    ${colorize(repo.description, 'gray')}`);
    }
    console.log(`    ${colorize(repo.url, 'gray')}`);
  }
  console.log('');
}

export async function cacheList(forceRefresh: boolean = false) {
  const isAuthenticated = await verifyGhAuth();
  if (!isAuthenticated) {
    logError('GitHub CLI is not authenticated');
    displayAuthInstructions();
    process.exit(1);
  }

  if (forceRefresh) {
    logInfo('Forcing cache refresh...');
  }

  const repos = await fetchOrgRepos({ forceRefresh });

  if (repos.length === 0) {
    logInfo('No repositories found');
    return;
  }

  console.log('\n' + colorize(`Organization repositories (${repos.length} total):`, 'cyan') + '\n');
  for (const repo of repos) {
    const visibility = repo.isPrivate ? colorize('private', 'yellow') : colorize('public', 'green');
    console.log(`  ${colorize(repo.name, 'bright')} [${visibility}]`);
    if (repo.description) {
      console.log(`    ${colorize(repo.description, 'gray')}`);
    }
  }
  console.log('');
  logInfo(`Showing ${repos.length} repositories. Use 'w cache search <query>' to filter.`);
}

export async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Cache Manager', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    // Support direct subcommand invocation (e.g. from cache-router)
    const action = process.argv[2];
    if (action === 'info' || action === 'refresh' || action === 'clear') {
      if (action === 'info') {
        await cacheInfo();
      } else if (action === 'refresh') {
        await cacheRefresh();
      } else if (action === 'clear') {
        await cacheClear();
      }
      return;
    }

    // Interactive mode (original behavior)
    const selectedAction = await select({
      message: 'Select action:',
      choices: [
        { name: 'View cache info', value: 'info' },
        { name: 'Refresh cache (force fetch from GitHub)', value: 'refresh' },
        { name: 'Clear cache', value: 'clear' },
      ],
    });

    if (selectedAction === 'info') {
      await cacheInfo();
    } else if (selectedAction === 'refresh') {
      await cacheRefresh();
    } else if (selectedAction === 'clear') {
      const confirmed = await confirm({
        message: 'Are you sure you want to clear the cache?',
        default: false,
      });

      if (confirmed) {
        await cacheClear();
      } else {
        logInfo('Cache clear cancelled');
      }
    }
  } catch (error) {
    logError('Failed to manage cache');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
