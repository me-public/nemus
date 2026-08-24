import { Command } from 'commander';
import { getGlobalOpts } from '../../utils/command-helpers';

export function registerCacheCommands(parent: Command) {
  const cache = parent
    .command('cache')
    .description('Cache management');

  cache
    .command('info')
    .description('View cache statistics')
    .action(async () => {
      const { cacheInfo } = await import('./manager');
      await cacheInfo();
    });

  cache
    .command('refresh')
    .description('Force refresh from GitHub')
    .action(async () => {
      const { cacheRefresh } = await import('./manager');
      await cacheRefresh();
    });

  cache
    .command('clear')
    .description('Clear the cache')
    .action(async () => {
      const { cacheClear } = await import('./manager');
      await cacheClear();
    });

  cache
    .command('search')
    .description('Search org repos by name or description')
    .argument('<query>', 'Search query')
    .option('--limit <n>', 'Max results', '20')
    .action(async (query, opts) => {
      const { cacheSearch } = await import('./manager');
      await cacheSearch(query, parseInt(opts.limit) || 20);
    });

  cache
    .command('list')
    .description('List all org repos')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      const { cacheList } = await import('./manager');
      await cacheList(globalOpts.forceRefresh);
    });
}
