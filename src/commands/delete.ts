import { Command } from 'commander';
import * as fs from 'fs/promises';
import { WORKSPACES_DIR } from '../utils/config';
import * as path from 'path';
import { listWorkspaces } from '../utils/workspace-meta';
import { promptMultiWorkspaceSelection } from '../utils/prompts';
import { logInfo, logSuccess, logError, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import { getGlobalOpts, parseList } from '../utils/command-helpers';

export function registerDeleteCommand(parent: Command) {
  parent
    .command('delete')
    .aliases(['d', 'del'])
    .description('Delete a workspace')
    .option('-w, --workspace <names>', 'Comma-separated workspace names')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleDelete({ ...opts, ...globalOpts });
    });
}

async function handleDelete(opts: {
  workspace?: string;
  yes: boolean;
  forceRefresh: boolean;
}) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Delete Workspace', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    // Non-interactive path: workspace names provided via flag
    if (opts.workspace) {
      const selectedNames = parseList(opts.workspace);
      const workspaces = await listWorkspaces();

      for (const name of selectedNames) {
        const workspace = workspaces.find(ws => ws.name === name);
        const workspacePath = path.join(WORKSPACES_DIR, name);
        if (workspace?.metadata) {
          console.log(`${colorize(name, 'cyan')}`);
          console.log(`  Repositories: ${workspace.metadata.repositories.length}`);
          console.log(`  Path: ${workspacePath}`);
        } else {
          console.log(`${colorize(name, 'cyan')}: ${workspacePath}`);
        }
      }
      console.log('');

      logWarning('This will permanently delete all cloned repositories in the selected workspaces!');

      if (!opts.yes) {
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: selectedNames.length === 1
              ? `Delete workspace ${selectedNames[0]}?`
              : `Delete these ${selectedNames.length} workspaces?`,
            default: true,
          },
        ]);
        if (!confirmed) {
          logInfo('Deletion cancelled');
          process.exit(0);
        }
      }

      for (const name of selectedNames) {
        const workspacePath = path.join(WORKSPACES_DIR, name);
        try {
          await fs.rm(workspacePath, { recursive: true, force: true });
          logSuccess(`Deleted "${colorize(name, 'cyan')}"`);
        } catch (error) {
          logError(`Failed to delete "${name}"`);
          if (error instanceof Error) logError(error.message);
        }
      }
      return;
    }

    // Interactive path
    while (true) {
      const workspaces = await listWorkspaces();

      if (workspaces.length === 0) {
        logInfo('No more workspaces remaining');
        break;
      }

      const selectedNames = await promptMultiWorkspaceSelection(workspaces);

      for (const name of selectedNames) {
        const workspace = workspaces.find(ws => ws.name === name);
        const workspacePath = path.join(WORKSPACES_DIR, name);
        if (workspace?.metadata) {
          console.log(`${colorize(name, 'cyan')}`);
          console.log(`  Repositories: ${workspace.metadata.repositories.length}`);
          console.log(`  Created: ${new Date(workspace.metadata.createdAt).toLocaleString()}`);
          console.log(`  Path: ${workspacePath}`);
        } else {
          console.log(`${colorize(name, 'cyan')}`);
          console.log(`  Path: ${workspacePath}`);
        }
      }
      console.log('');

      logWarning('This will permanently delete all cloned repositories in the selected workspaces!');

      const confirmMessage = selectedNames.length === 1
        ? `Delete workspace ${selectedNames[0]}?`
        : `Delete these ${selectedNames.length} workspaces?`;

      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: confirmMessage,
          default: true,
        },
      ]);

      if (confirmed) {
        for (const name of selectedNames) {
          const workspacePath = path.join(WORKSPACES_DIR, name);
          try {
            await fs.rm(workspacePath, { recursive: true, force: true });
            logSuccess(`Deleted "${colorize(name, 'cyan')}"`);
          } catch (error) {
            logError(`Failed to delete "${name}"`);
            if (error instanceof Error) logError(error.message);
          }
        }
      }

      const remaining = await listWorkspaces();
      if (remaining.length === 0) {
        logInfo('No more workspaces remaining');
        break;
      }

      const { deleteMore } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'deleteMore',
          message: 'Delete more workspaces?',
          default: false,
        },
      ]);

      if (!deleteMore) {
        break;
      }
    }
  } catch (error) {
    logError('Failed to delete workspace');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

/**
 * Legacy main() for backward compatibility with tests.
 */
export async function main() {
  await handleDelete({ yes: false, forceRefresh: false });
}
