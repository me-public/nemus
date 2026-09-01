import { Command } from 'commander';
import { getUserConfig, saveUserConfig, CONFIG_PATH } from '../utils/config';
import {
  CONFIG_KEYS,
  CONFIG_SCHEMA,
  isConfigKey,
  applyConfigSet,
  applyConfigUnset,
  formatConfigValue,
} from '../utils/config-schema';
import { outputJson, outputJsonError } from '../utils/output';
import { logSuccess, logError } from '../utils/logger';
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
