#!/usr/bin/env ts-node

import { listSuites } from '../../utils/suite';
import { logInfo, logError } from '../../utils/logger';
import { colorize } from '../../utils/colors';

export async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Saved Suites', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const suites = await listSuites();

    if (suites.length === 0) {
      logInfo('No suites found');
      console.log('\nCreate a new suite with:');
      console.log('  workspace suite-create\n');
      return;
    }

    for (const suite of suites) {
      console.log(colorize(suite.name, 'cyan'));
      if (suite.description) {
        console.log(`  ${suite.description}`);
      }
      console.log(`  Repositories: ${colorize(String(suite.entries.length), 'yellow')}`);

      for (const entry of suite.entries) {
        const alias = entry.directoryName !== entry.repoName ? ` (${entry.repoName})` : '';
        console.log(`    - ${entry.directoryName}${alias}`);
      }

      const createdDate = new Date(suite.createdAt).toLocaleString();
      const updatedDate = new Date(suite.updatedAt).toLocaleString();
      console.log(`  Created: ${createdDate}`);
      if (suite.updatedAt !== suite.createdAt) {
        console.log(`  Updated: ${updatedDate}`);
      }

      console.log('');
    }

    console.log('='.repeat(60) + '\n');
  } catch (error) {
    logError('Failed to list suites');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
