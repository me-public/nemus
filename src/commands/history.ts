import { Command } from 'commander';
import { readHistory, getOperationStats, filterHistory, clearHistory } from '../utils/history';
import { logError, logInfo, logStep, logSuccess } from '../utils/logger';
import { colorize } from '../utils/colors';
import { confirm } from '../utils/prompt';
import { getGlobalOpts } from '../utils/command-helpers';

const displayHistoryTable = (records: Array<{ timestamp: string; command: string; workspace?: string; duration: number; success: boolean; error?: string }>) => {
  if (records.length === 0) {
    logInfo('No operation history found');
    return;
  }

  console.log('\n' + colorize('═'.repeat(120), 'gray'));
  console.log(
    colorize('Time', 'bright').padEnd(25) +
    colorize('Command', 'bright').padEnd(25) +
    colorize('Workspace', 'bright').padEnd(25) +
    colorize('Duration', 'bright').padEnd(15) +
    colorize('Status', 'bright')
  );
  console.log(colorize('─'.repeat(120), 'gray'));

  for (const record of records) {
    const time = new Date(record.timestamp).toLocaleString().padEnd(15);
    const command = record.command.padEnd(15);
    const workspace = (record.workspace || '-').padEnd(15);
    const duration = `${(record.duration / 1000).toFixed(1)}s`.padEnd(10);
    const status = record.success
      ? colorize('✓ Success', 'green')
      : colorize('✗ Failed', 'red') + (record.error ? ` (${record.error})` : '');

    console.log(`${time} ${command} ${workspace} ${duration} ${status}`);
  }

  console.log(colorize('═'.repeat(120), 'gray') + '\n');
};

const displayStats = (stats: { totalOperations: number; successRate: number; avgDuration: number; commandCounts: Record<string, number> }) => {
  console.log(colorize('Operation Statistics', 'bright'));
  console.log(colorize('─'.repeat(60), 'gray'));
  console.log(`Total Operations: ${colorize(String(stats.totalOperations), 'cyan')}`);
  console.log(`Success Rate: ${colorize(`${stats.successRate.toFixed(1)}%`, 'green')}`);
  console.log(`Average Duration: ${colorize(`${(stats.avgDuration / 1000).toFixed(1)}s`, 'yellow')}`);

  console.log(`\n${colorize('Command Usage', 'bright')}`);
  const sortedCommands = Object.entries(stats.commandCounts).sort((a, b) => b[1] - a[1]);

  for (const [command, count] of sortedCommands) {
    console.log(`  ${command.padEnd(20)} ${colorize(String(count), 'cyan')} times`);
  }
  console.log('');
};

export function registerHistoryCommand(parent: Command) {
  const history = parent
    .command('history')
    .alias('h')
    .description('View operation history');

  history
    .command('show', { isDefault: true })
    .description('Show recent operations')
    .argument('[limit]', 'Number of records to show', '20')
    .option('--command <cmd>', 'Filter by command')
    .option('--workspace <name>', 'Filter by workspace')
    .action(async (limit, opts) => {
      await handleHistoryShow(parseInt(limit) || 20, opts);
    });

  history
    .command('stats')
    .description('Show detailed statistics')
    .action(async () => {
      logStep('Calculating statistics...');
      const stats = await getOperationStats();
      displayStats(stats);
    });

  history
    .command('clear')
    .description('Clear all history')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      if (globalOpts.yes) {
        await clearHistory();
        logSuccess('Operation history cleared');
        return;
      }

      const confirmed = await confirm({
        message: 'Are you sure you want to clear operation history?',
        default: false,
      });

      if (confirmed) {
        await clearHistory();
        logSuccess('Operation history cleared');
      } else {
        logInfo('Operation cancelled');
      }
    });
}

async function handleHistoryShow(limit: number, opts: { command?: string; workspace?: string }) {
  try {
    logStep(`Fetching operation history (last ${limit} records)...`);

    let records;
    if (opts.command || opts.workspace) {
      records = await filterHistory(opts.command, opts.workspace);
      records = records.slice(0, limit);
    } else {
      records = await readHistory(limit);
    }

    displayHistoryTable(records);

    const stats = await getOperationStats();
    console.log(colorize('Quick Stats:', 'bright'));
    console.log(`  Total Operations: ${stats.totalOperations}`);
    console.log(`  Success Rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`  Average Duration: ${(stats.avgDuration / 1000).toFixed(1)}s`);
    console.log('');
  } catch (error) {
    logError('Failed to retrieve history');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
