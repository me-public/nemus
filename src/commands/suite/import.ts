#!/usr/bin/env ts-node

import * as fs from 'fs/promises';
import * as path from 'path';
import { importSuites } from '../../utils/suite';
import { logInfo, logSuccess, logError, logWarning } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { SuitesStore } from '../../types';
import { confirm, input } from '../../utils/prompt';

export async function main(opts?: { file?: string }) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Import Suite', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const fileArg = opts?.file;
    let filePath: string;

    if (fileArg && !fileArg.startsWith('-')) {
      filePath = path.resolve(fileArg);
    } else {
      const inputPath = await input({
        message: 'Path to suite JSON file:',
        validate: (input: string) => input.trim().length > 0 || 'File path is required',
      });
      filePath = path.resolve(inputPath);
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      logError(`Could not read file: ${filePath}`);
      process.exit(1);
    }

    let data: SuitesStore;
    try {
      data = JSON.parse(content);
    } catch {
      logError('Invalid JSON file');
      process.exit(1);
    }

    if (!data.suites || !Array.isArray(data.suites)) {
      logError('Invalid suite file format: missing "suites" array');
      process.exit(1);
    }

    console.log(`Found ${colorize(String(data.suites.length), 'yellow')} suite(s):\n`);
    for (const suite of data.suites) {
      console.log(`  ${colorize(suite.name, 'cyan')} (${suite.entries?.length ?? 0} repos)`);
      if (suite.description) {
        console.log(`    ${suite.description}`);
      }
    }
    console.log('');

    const overwrite = await confirm({
      message: 'Overwrite existing suites with the same name?',
      default: false,
    });

    const result = await importSuites(data, overwrite);

    if (result.imported.length > 0) {
      logSuccess(`Imported: ${result.imported.join(', ')}`);
    }

    if (result.skipped.length > 0) {
      logInfo(`Skipped (already exist): ${result.skipped.join(', ')}`);
    }

    if (result.errors.length > 0) {
      logWarning('Errors:');
      for (const err of result.errors) {
        logError(`  ${err}`);
      }
    }

    console.log('');
  } catch (error) {
    logError('Failed to import suite');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
