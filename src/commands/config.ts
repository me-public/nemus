import { Command } from 'commander';
import * as fs from 'fs';
import { getUserConfig, saveUserConfig, CONFIG_PATH } from '../utils/config';
import { openInEditor } from '../utils/editor';
import {
  CONFIG_KEYS,
  CONFIG_SCHEMA,
  isConfigKey,
  applyConfigSet,
  applyConfigUnset,
  reviewConfigFileText,
  formatConfigValue,
} from '../utils/config-schema';
import { outputJson, outputJsonError } from '../utils/output';
import { logSuccess, logError, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';

/**
 * Non-interactive config management: `nemus config get/set/unset/list/path`.
 * Complements the interactive `configure` wizard and is script-friendly —
 * `get`/`list` write DATA to stdout (raw value, or JSON with --json), logs go to
 * stderr. Values are validated/coerced against config-schema.ts.
 */
export function registerConfigCommand(parent: Command): void {
  const config = parent.command('config').description('Get or set Nemus configuration');

  config
    .command('get')
    .description('Print a config value (or all values with no key)')
    .argument('[key]', 'Config key')
    .option('--json', 'Output as JSON')
    .action((key: string | undefined, opts: { json?: boolean }) => {
      const cfg = getUserConfig();
      if (key === undefined) {
        printAll(cfg, opts.json);
        return;
      }
      if (!isConfigKey(key)) {
        if (opts.json) outputJsonError(`Unknown config key "${key}"`);
        else logError(`Unknown config key "${key}". Run "nemus config list" to see valid keys.`);
        process.exitCode = 1;
        return;
      }
      const value = cfg[key];
      if (opts.json) outputJson({ key, value });
      else process.stdout.write(formatConfigValue(value) + '\n');
    });

  config
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'New value')
    .option('--json', 'Output as JSON')
    .action((key: string, value: string, opts: { json?: boolean }) => {
      const result = applyConfigSet(getUserConfig(), key, value);
      if (!result.ok) {
        if (opts.json) outputJsonError(result.error);
        else logError(result.error);
        process.exitCode = 1;
        return;
      }
      saveUserConfig(result.next);
      if (opts.json) outputJson({ ok: true, key, value: result.value });
      else logSuccess(`Set ${colorize(key, 'cyan')} = ${formatConfigValue(result.value)}`);
    });

  config
    .command('unset')
    .description('Reset a config value to its default')
    .argument('<key>', 'Config key')
    .option('--json', 'Output as JSON')
    .action((key: string, opts: { json?: boolean }) => {
      const result = applyConfigUnset(getUserConfig(), key);
      if (!result.ok) {
        if (opts.json) outputJsonError(result.error);
        else logError(result.error);
        process.exitCode = 1;
        return;
      }
      saveUserConfig(result.next);
      if (opts.json) outputJson({ ok: true, key, value: result.value });
      else logSuccess(`Reset ${colorize(key, 'cyan')} to default (${formatConfigValue(result.value)})`);
    });

  config
    .command('list')
    .alias('ls')
    .description('List all config keys and current values')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => printAll(getUserConfig(), opts.json));

  config
    .command('path')
    .description('Print the path to the config file')
    .action(() => {
      process.stdout.write(CONFIG_PATH + '\n');
    });

  config
    .command('edit')
    .description('Open the config file in $EDITOR (or $VISUAL)')
    .action(() => {
      handleEdit();
    });
}

function handleEdit(): void {
  if (!process.stdout.isTTY) {
    logError('`config edit` needs an interactive terminal. Use `config set <key> <value>` in scripts.');
    process.exitCode = 1;
    return;
  }
  // Seed the file with the fully-resolved config so there's something complete
  // to edit on a first run (getUserConfig merges defaults + any overrides).
  if (!fs.existsSync(CONFIG_PATH)) saveUserConfig(getUserConfig());

  const result = openInEditor(CONFIG_PATH);
  if (!result.ok) {
    logError(result.error ?? `editor exited with code ${result.code}`);
    process.exitCode = 1;
    return;
  }

  // Re-validate: a hand-edit can produce invalid JSON or invalid values, which
  // getUserConfig would silently ignore (falling back to defaults). Surface that
  // instead, using the SAME schema `config set` uses so both write paths agree.
  const review = reviewConfigFileText(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (review.parseError) {
    logError(`${CONFIG_PATH} is not valid JSON after editing — changes are kept, but Nemus will use defaults until it parses.`);
    process.exitCode = 1;
    return;
  }
  if (review.notObject) {
    logError(`${CONFIG_PATH} must contain a JSON object — changes are kept, but Nemus will use defaults until it does.`);
    process.exitCode = 1;
    return;
  }
  if (review.unknownKeys.length > 0) logWarning(`Ignoring unrecognized key(s): ${review.unknownKeys.join(', ')}`);
  if (!review.ok) {
    for (const e of review.invalid) logWarning(e);
    logError('Some values are invalid and will fall back to their defaults until fixed.');
    process.exitCode = 1;
    return;
  }
  logSuccess('Config saved.');
}

function printAll(cfg: ReturnType<typeof getUserConfig>, json?: boolean): void {
  if (json) {
    const values: Record<string, unknown> = {};
    for (const key of CONFIG_KEYS) values[key] = cfg[key];
    outputJson({ path: CONFIG_PATH, values });
    return;
  }
  const width = Math.max(...CONFIG_KEYS.map((k) => k.length));
  console.log(colorize('Nemus configuration', 'bright') + colorize(`  (${CONFIG_PATH})`, 'dim'));
  for (const key of CONFIG_KEYS) {
    const val = formatConfigValue(cfg[key]);
    const shown = val === '' ? colorize('(empty)', 'dim') : val;
    console.log(`  ${key.padEnd(width)}  ${shown}  ${colorize(CONFIG_SCHEMA[key].describe, 'dim')}`);
  }
}
