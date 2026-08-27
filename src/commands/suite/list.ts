#!/usr/bin/env ts-node

import { listSuites } from '../../utils/suite';
import { logInfo, logError } from '../../utils/logger';
import { outputJson, outputJsonError } from '../../utils/output';
import { colorize } from '../../utils/colors';

export async function main(opts: { json?: boolean } = {}) {
  try {
    const suites = await listSuites();

    if (opts.json) {
      outputJson({
        count: suites.length,
        suites: suites.map(s => ({
          name: s.name,
          description: s.description ?? null,
          repoCount: s.entries.length,
          entries: s.entries.map(e => ({ directoryName: e.directoryName, repoName: e.repoName })),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
      return;
    }

    console.log('\n' + '='.repeat(60));
    console.log(colorize('Saved Suites', 'bright'));
    console.log('='.repeat(60) + '\n');

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
    if (opts.json) {
      outputJsonError(error instanceof Error ? error.message : 'Failed to list suites');
    } else {
      logError('Failed to list suites');
      if (error instanceof Error) logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
