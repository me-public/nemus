import { Command } from 'commander';
import { getGlobalOpts } from '../../utils/command-helpers';

export function registerSuiteCommands(parent: Command) {
  const suite = parent
    .command('suite')
    .description('Suite management');

  suite
    .command('create')
    .description('Create a new suite (pick repos or save from workspace)')
    .action(async () => {
      const { main } = await import('./create');
      await main();
    });

  suite
    .command('list')
    .description('List all saved suites')
    .action(async () => {
      const { main } = await import('./list');
      await main();
    });

  suite
    .command('delete')
    .description('Delete a suite')
    .action(async () => {
      const { main } = await import('./delete');
      await main();
    });

  suite
    .command('export')
    .description('Export suite(s) to JSON file for sharing')
    .argument('[file]', 'Output file path')
    .action(async (file) => {
      const { main } = await import('./export');
      await main({ file });
    });

  suite
    .command('import')
    .description('Import suite(s) from JSON file')
    .argument('[file]', 'Input file path')
    .action(async (file) => {
      const { main } = await import('./import');
      await main({ file });
    });

  suite
    .command('use')
    .description('Create workspace from a suite')
    .option('-s, --suite <name>', 'Suite name')
    .option('-w, --workspace <name>', 'Workspace name')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      const { main } = await import('./use');
      await main({
        suite: opts.suite,
        workspace: opts.workspace,
        yes: globalOpts.yes,
        forceRefresh: globalOpts.forceRefresh,
      });
    });
}
