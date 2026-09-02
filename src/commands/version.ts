import { Command } from 'commander';
import { outputJson } from '../utils/output';

export interface VersionInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
}

/**
 * Build the version payload. Pure and process-injectable so the JSON shape is
 * unit-testable without reading the real runtime.
 */
export function buildVersionInfo(
  version: string,
  proc: Pick<NodeJS.Process, 'versions' | 'platform' | 'arch'> = process,
): VersionInfo {
  return {
    version,
    node: proc.versions.node,
    platform: proc.platform,
    arch: proc.arch,
  };
}

/**
 * `nemus version` — a subcommand companion to the `-V/--version` flag, for
 * people who type `nemus version`. `--json` also reports the Node/OS runtime
 * (handy for bug reports), emitting a single JSON document to stdout.
 */
export function registerVersionCommand(program: Command, version: string) {
  program
    .command('version')
    .description('Print the Nemus version (with --json for version + runtime info)')
    .option('--json', 'Output version + runtime info as JSON')
    .action((opts: { json?: boolean }) => {
      const info = buildVersionInfo(version);
      if (opts.json) {
        outputJson(info);
      } else {
        process.stdout.write(`nemus ${info.version}\n`);
      }
    });
}
