import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import { listWorkspaces } from '../utils/workspace-meta';
import { getWorkspaceSessions } from '../utils/claude-sessions';
import { logInfo, logError } from '../utils/logger';
import { outputJson } from '../utils/output';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import * as fuzzy from 'fuzzy';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

const TEMP_FILE = path.join(os.homedir(), '.workspace-last-go');
const RESUME_FLAG_FILE = path.join(os.homedir(), '.workspace-resume-session');

interface WorkspaceItem {
  name: string;
  wsPath: string;
  repoCount: number;
  createdAt: string;
  lastActiveLabel: string | null;
  lastActiveAt: number;
  hasSession: boolean;
}

export function registerListCommand(parent: Command) {
  parent
    .command('list')
    .alias('l')
    .description('List workspaces and navigate to one')
    .option('-a, --archived', 'Show archived workspaces')
    .option('--json', 'Output as JSON (no interactive selection)')
    .action(async (opts) => {
      await handleList(opts);
    });
}

async function handleList(opts: { archived?: boolean; json?: boolean }) {
  const showArchived = opts.archived ?? false;
  const title = showArchived ? 'Archived Workspaces' : 'Existing Workspaces';

  try {
    const [workspaces, sessions] = await Promise.all([
      showArchived
        ? listWorkspaces(true).then(ws => ws.filter(w => w.metadata?.archivedAt))
        : listWorkspaces(false),
      getWorkspaceSessions(),
    ]);

    if (workspaces.length === 0) {
      if (opts.json) {
        outputJson({ archived: showArchived, count: 0, workspaces: [] });
        return;
      }
      console.log('\n' + '='.repeat(60));
      console.log(colorize(title, 'bright'));
      console.log('='.repeat(60) + '\n');
      if (showArchived) {
        logInfo('No archived workspaces found');
      } else {
        logInfo('No workspaces found');
        console.log('\nCreate a new workspace with:');
        console.log('  workspace create\n');
      }
      return;
    }

    const sessionMap = new Map(sessions.map(s => [s.workspaceName, s]));

    const items: WorkspaceItem[] = workspaces.map(ws => {
      const session = sessionMap.get(ws.name);
      const repoCount = ws.metadata?.repositories?.length ?? 0;
      return {
        name: ws.name,
        wsPath: ws.path,
        repoCount,
        createdAt: ws.metadata?.createdAt ?? '',
        lastActiveLabel: session?.lastActiveLabel ?? null,
        lastActiveAt: session?.lastActiveAt.getTime() ?? 0,
        hasSession: !!session,
      };
    });

    items.sort((a, b) => {
      if (a.hasSession && b.hasSession) return b.lastActiveAt - a.lastActiveAt;
      if (a.hasSession) return -1;
      if (b.hasSession) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // JSON mode: one document to stdout, no table, no interactive selection.
    if (opts.json) {
      outputJson({
        archived: showArchived,
        count: items.length,
        workspaces: items.map(i => ({
          name: i.name,
          path: i.wsPath,
          repoCount: i.repoCount,
          createdAt: i.createdAt || null,
          lastActive: i.lastActiveLabel,
          hasSession: i.hasSession,
        })),
      });
      return;
    }

    console.log('');
    console.log(colorize('  ' + title, 'bright') + colorize('  (sorted by last active)', 'dim'));
    console.log(colorize('  ' + '─'.repeat(54), 'dim'));

    const maxNameLen = Math.max(...items.map(i => i.name.length));

    for (const item of items) {
      const name = item.name.padEnd(maxNameLen);
      const active = item.lastActiveLabel
        ? colorize(item.lastActiveLabel, 'yellow')
        : colorize('no session', 'dim');
      const repos = colorize(`${item.repoCount} repos`, 'dim');

      if (showArchived) {
        const ws = workspaces.find(w => w.name === item.name);
        if (ws?.metadata?.archivedAt) {
          const daysSinceArchive = (Date.now() - new Date(ws.metadata.archivedAt).getTime()) / (1000 * 60 * 60 * 24);
          const daysRemaining = Math.max(0, Math.ceil(30 - daysSinceArchive));
          const archiveLabel = colorize(`${daysRemaining}d left`, 'red');
          console.log(`  ${colorize(name, 'cyan')}  ${active}  ${repos}  ${archiveLabel}`);
        }
      } else {
        console.log(`  ${colorize(name, 'cyan')}  ${active}  ${repos}`);
      }
    }
    console.log('');

    if (items.length > 0 && (process.stdout.isTTY || process.env.VITEST === 'true')) {
      const { selected } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'selected',
          message: 'Select workspace to open:',
          source: async (_answersSoFar: any, input: string | undefined) => {
            const searchInput = input || '';

            const source = items.map(item => ({
              name: `${item.name}  ${item.lastActiveLabel ? colorize(item.lastActiveLabel, 'dim') : colorize('no session', 'dim')}  ${colorize(`${item.repoCount} repos`, 'dim')}`,
              value: item.name,
            }));

            if (!searchInput) return source;

            const results = fuzzy.filter(searchInput, items, {
              extract: (item) => item.name,
            });

            return results.map(result => ({
              name: `${result.original.name}  ${result.original.lastActiveLabel ? colorize(result.original.lastActiveLabel, 'dim') : colorize('no session', 'dim')}  ${colorize(`${result.original.repoCount} repos`, 'dim')}`,
              value: result.original.name,
            }));
          },
          pageSize: 15,
        } as any,
      ]);

      const selectedItem = items.find(i => i.name === selected);
      if (selectedItem) {
        await fsPromises.writeFile(TEMP_FILE, selectedItem.wsPath, 'utf-8');
        if (selectedItem.hasSession) {
          const session = sessionMap.get(selectedItem.name);
          if (session) {
            await fsPromises.writeFile(RESUME_FLAG_FILE, JSON.stringify({
              sessionId: session.sessionId,
              agentType: session.agentType,
            }), 'utf-8');
          }
        }
      }
    }

  } catch (error) {
    logError('Failed to list workspaces');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

/**
 * Legacy main() for backward compatibility with tests.
 * Reads process.argv to determine options.
 */
export async function main() {
  const args = process.argv.slice(2);
  const archived = args.includes('--archived') || args.includes('-a');
  const json = args.includes('--json');
  await handleList({ archived, json });
}
