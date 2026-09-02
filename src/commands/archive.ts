import { Command } from 'commander';
import { listWorkspaces, archiveWorkspace, unarchiveWorkspace } from '../utils/workspace-meta';
import { promptMultiWorkspaceSelection } from '../utils/prompts';
import { logInfo, logSuccess, logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { confirm } from '../utils/prompt';
import { getGlobalOpts, parseList } from '../utils/command-helpers';

export function registerArchiveCommand(parent: Command) {
  parent
    .command('archive')
    .alias('a')
    .description('Archive a workspace (30-day expiry)')
    .option('-w, --workspace <names>', 'Comma-separated workspace names')
    .option('--unarchive', 'Unarchive a previously archived workspace')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleArchive({ ...opts, ...globalOpts });
    });
}

async function handleArchive(opts: {
  workspace?: string;
  unarchive?: boolean;
  yes: boolean;
  forceRefresh: boolean;
}) {
  const isUnarchive = opts.unarchive ?? false;
  const title = isUnarchive ? 'Unarchive Workspace' : 'Archive Workspace';
  console.log('\n' + '='.repeat(60));
  console.log(colorize(title, 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    if (isUnarchive) {
      const allWorkspaces = await listWorkspaces(true);
      const archivedWorkspaces = allWorkspaces.filter(ws => ws.metadata?.archivedAt);

      if (archivedWorkspaces.length === 0) {
        logInfo('No archived workspaces found');
        return;
      }

      let selectedNames: string[];

      if (opts.workspace) {
        selectedNames = parseList(opts.workspace);
      } else {
        selectedNames = await promptMultiWorkspaceSelection(archivedWorkspaces);
      }

      if (!opts.yes) {
        const confirmed = await confirm({
          message: selectedNames.length === 1
            ? `Unarchive workspace ${selectedNames[0]}?`
            : `Unarchive these ${selectedNames.length} workspaces?`,
          default: true,
        });
        if (!confirmed) return;
      }

      for (const name of selectedNames) {
        try {
          await unarchiveWorkspace(name);
          logSuccess(`Unarchived "${colorize(name, 'cyan')}"`);
        } catch (error) {
          logError(`Failed to unarchive "${name}"`);
          if (error instanceof Error) logError(error.message);
        }
      }
    } else {
      const workspaces = await listWorkspaces(false);

      if (workspaces.length === 0) {
        logInfo('No active workspaces found');
        return;
      }

      let selectedNames: string[];

      if (opts.workspace) {
        selectedNames = parseList(opts.workspace);
      } else {
        selectedNames = await promptMultiWorkspaceSelection(workspaces);
      }

      if (!opts.yes) {
        const confirmed = await confirm({
          message: selectedNames.length === 1
            ? `Archive workspace ${selectedNames[0]}? It will be auto-deleted in 30 days.`
            : `Archive these ${selectedNames.length} workspaces? They will be auto-deleted in 30 days.`,
          default: true,
        });
        if (!confirmed) return;
      }

      for (const name of selectedNames) {
        try {
          await archiveWorkspace(name);
          logSuccess(`Archived "${colorize(name, 'cyan')}" - will be auto-deleted in 30 days`);
        } catch (error) {
          logError(`Failed to archive "${name}"`);
          if (error instanceof Error) logError(error.message);
        }
      }
    }
  } catch (error) {
    logError(`Failed to ${isUnarchive ? 'unarchive' : 'archive'} workspace`);
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
