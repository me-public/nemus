import { Command } from 'commander';
import * as fs from 'fs/promises';
import { safeWorkspacePath } from '../utils/validation';
import { listWorkspaces } from '../utils/workspace-meta';
import { promptMultiWorkspaceSelection } from '../utils/prompts';
import { logInfo, logSuccess, logError, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { confirm } from '../utils/prompt';
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
      const known = new Map(workspaces.map(ws => [ws.name, ws]));

      // Resolve to validated, existing targets. safeWorkspacePath() both
      // enforces the name allowlist and pins the path inside WORKSPACES_DIR, so
      // a name like "../../etc" can never reach fs.rm; unknown names are skipped
      // rather than deleted at a guessed path.
      const targets: { name: string; path: string; workspace: typeof workspaces[number] }[] = [];
      for (const name of selectedNames) {
        const workspace = known.get(name);
        if (!workspace) {
          logError(`Workspace "${name}" not found — skipping`);
          continue;
        }
        let workspacePath: string;
        try {
          workspacePath = safeWorkspacePath(name);
        } catch (error) {
          logError(error instanceof Error ? error.message : `Invalid workspace name "${name}"`);
          continue;
        }
        targets.push({ name, path: workspacePath, workspace });
      }

      if (targets.length === 0) {
        logInfo('Nothing to delete');
        return;
      }

      for (const { name, path: workspacePath, workspace } of targets) {
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
        const confirmed = await confirm({
          message: targets.length === 1
            ? `Delete workspace ${targets[0].name}?`
            : `Delete these ${targets.length} workspaces?`,
          default: true,
        });
        if (!confirmed) {
          logInfo('Deletion cancelled');
          process.exit(0);
        }
      }

      for (const { name, path: workspacePath } of targets) {
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

      // Resolve + validate paths once. Names come from disk, but safeWorkspacePath
      // must not throw mid-flow and crash the interactive session, so skip any
      // name that fails the allowlist rather than aborting.
      const resolved: { name: string; path: string; workspace: typeof workspaces[number] | undefined }[] = [];
      for (const name of selectedNames) {
        try {
          resolved.push({ name, path: safeWorkspacePath(name), workspace: workspaces.find(ws => ws.name === name) });
        } catch (error) {
          logError(error instanceof Error ? error.message : `Invalid workspace name "${name}"`);
        }
      }

      if (resolved.length > 0) {
        for (const { name, path: workspacePath, workspace } of resolved) {
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

        const confirmMessage = resolved.length === 1
          ? `Delete workspace ${resolved[0].name}?`
          : `Delete these ${resolved.length} workspaces?`;

        const confirmed = await confirm({
          message: confirmMessage,
          default: true,
        });

        if (confirmed) {
          for (const { name, path: workspacePath } of resolved) {
            try {
              await fs.rm(workspacePath, { recursive: true, force: true });
              logSuccess(`Deleted "${colorize(name, 'cyan')}"`);
            } catch (error) {
              logError(`Failed to delete "${name}"`);
              if (error instanceof Error) logError(error.message);
            }
          }
        }
      }

      const remaining = await listWorkspaces();
      if (remaining.length === 0) {
        logInfo('No more workspaces remaining');
        break;
      }

      const deleteMore = await confirm({
        message: 'Delete more workspaces?',
        default: false,
      });

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
