#!/usr/bin/env ts-node

import * as fs from 'fs/promises';
import * as path from 'path';
import { listSuites, exportSuite, exportAllSuites } from '../../utils/suite';
import { logInfo, logSuccess, logError } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { input, select } from '../../utils/prompt';

export async function main(opts?: { file?: string }) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Export Suite', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const suites = await listSuites();

    if (suites.length === 0) {
      logInfo('No suites found');
      process.exit(0);
    }

    const mode = await select({
      message: 'What would you like to export?',
      choices: [
        { name: 'A single suite', value: 'single' },
        { name: 'All suites', value: 'all' },
      ],
    });

    let data;
    let defaultFilename: string;

    if (mode === 'single') {
      const suiteName = await select({
        message: 'Select a suite to export:',
        choices: suites.map(s => ({
          name: `${s.name} (${s.entries.length} repos)${s.description ? ` - ${s.description}` : ''}`,
          value: s.name,
        })),
        pageSize: 15,
      });

      data = await exportSuite(suiteName);
      if (!data) {
        logError(`Suite "${suiteName}" not found`);
        process.exit(1);
      }

      defaultFilename = `${suiteName}-suite.json`;
    } else {
      data = await exportAllSuites();
      defaultFilename = 'all-suites.json';
    }

    const outputArg = opts?.file;
    let outputPath: string;

    if (outputArg && !outputArg.startsWith('-')) {
      outputPath = path.resolve(outputArg);
    } else {
      const filePath = await input({
        message: 'Output file path:',
        default: `./${defaultFilename}`,
      });
      outputPath = path.resolve(filePath);
    }

    await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    logSuccess(`Exported to ${colorize(outputPath, 'cyan')}`);

    const suiteCount = data.suites.length;
    const totalRepos = data.suites.reduce((sum, s) => sum + s.entries.length, 0);
    console.log(`  ${suiteCount} suite(s), ${totalRepos} total repositories\n`);
  } catch (error) {
    logError('Failed to export suite');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
