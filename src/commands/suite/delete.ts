#!/usr/bin/env ts-node

import { listSuites, deleteSuite } from '../../utils/suite';
import { logInfo, logSuccess, logError } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { confirm, select } from '../../utils/prompt';

export async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Delete Suite', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const suites = await listSuites();

    if (suites.length === 0) {
      logInfo('No suites found');
      process.exit(0);
    }

    const suiteName = await select({
      message: 'Select a suite to delete:',
      choices: suites.map(s => ({
        name: `${s.name} (${s.entries.length} repos)${s.description ? ` - ${s.description}` : ''}`,
        value: s.name,
      })),
      pageSize: 15,
    });

    const confirmed = await confirm({
      message: `Are you sure you want to delete suite "${suiteName}"?`,
      default: false,
    });

    if (!confirmed) {
      logInfo('Deletion cancelled');
      process.exit(0);
    }

    const deleted = await deleteSuite(suiteName);

    if (deleted) {
      logSuccess(`Suite "${colorize(suiteName, 'cyan')}" deleted`);
    } else {
      logError(`Suite "${suiteName}" not found`);
    }
  } catch (error) {
    logError('Failed to delete suite');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
