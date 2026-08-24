import { Command } from 'commander';
import { getGlobalOpts } from '../../utils/command-helpers';

export function registerBranchCommands(parent: Command) {
  const branch = parent
    .command('branch')
    .description('Branch management');

  branch
    .command('switch')
    .description('Switch all repos to a specific branch')
    .option('-w, --workspace <name>', 'Workspace name')
    .option('-b, --branch <name>', 'Branch name')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      const { main } = await import('./switch');
      await main({
        workspace: opts.workspace,
        branch: opts.branch,
        yes: globalOpts.yes,
      });
    });

  branch
    .command('create')
    .description('Create branches across all repos')
    .argument('[workspace]', 'Workspace name')
    .argument('[branch]', 'Branch name')
    .option('-w, --workspace <name>', 'Workspace name (flag alternative)')
    .option('-b, --branch <name>', 'Branch name (flag alternative)')
    .option('--base <branch>', 'Base branch')
    .option('--force', 'Force create')
    .action(async (workspaceArg, branchArg, opts) => {
      const { main } = await import('./create');
      await main({
        workspace: opts.workspace || workspaceArg,
        branch: opts.branch || branchArg,
        base: opts.base,
        force: opts.force,
      });
    });

  branch
    .command('merge')
    .description('Merge branches across all repos')
    .argument('<workspace>', 'Workspace name')
    .argument('<source>', 'Source branch')
    .argument('<target>', 'Target branch')
    .option('--no-ff', 'No fast-forward')
    .option('--ff-only', 'Fast-forward only')
    .option('--squash', 'Squash merge')
    .action(async (workspace, source, target, opts) => {
      const { main } = await import('./merge');
      await main({
        workspace,
        source,
        target,
        // Commander's --no-ff sets opts.ff = false
        noFf: opts.ff === false,
        ffOnly: opts.ffOnly,
        squash: opts.squash,
      });
    });

  branch
    .command('rebase')
    .description('Rebase branches across all repos')
    .argument('<workspace>', 'Workspace name')
    .argument('<base>', 'Base branch')
    .action(async (workspace, base) => {
      const { main } = await import('./rebase');
      await main({ workspace, base });
    });
}
