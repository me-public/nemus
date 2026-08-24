import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import * as fs from 'fs/promises';
import * as os from 'os';
import { listWorkspaces } from '../utils/workspace-meta';
import { getWorkspaceSessions } from '../utils/claude-sessions';
import { logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import * as fuzzy from 'fuzzy';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

const TEMP_FILE = path.join(os.homedir(), '.workspace-last-go');
const RESUME_FLAG_FILE = path.join(os.homedir(), '.workspace-resume-session');

export function registerGoCommand(parent: Command) {
  parent
    .command('go')
    .description('Quick navigate to workspace')
    .argument('[workspace]', 'Workspace name')
    .action(async (workspace) => {
      await handleGo(workspace);
    });
}

async function handleGo(workspaceArg?: string) {
  try {
    let selectedWorkspace: string;

    if (workspaceArg) {
      selectedWorkspace = workspaceArg;
    } else {
      const [workspaces, sessions] = await Promise.all([
        listWorkspaces(),
        getWorkspaceSessions(),
      ]);

      if (workspaces.length === 0) {
        logError('No workspaces found');
        process.exit(1);
        return;
      }

      // Build session map, keeping most-recent session per workspace
      // (sessions are sorted most-recent-first, so first entry wins)
      const sessionMap = new Map<string, typeof sessions[0]>();
      for (const session of sessions) {
        if (!sessionMap.has(session.workspaceName)) {
          sessionMap.set(session.workspaceName, session);
        }
      }

      const items = workspaces.map(ws => ({
        name: ws.name,
        repoCount: ws.metadata?.repositories?.length ?? 0,
        lastActiveLabel: sessionMap.get(ws.name)?.lastActiveLabel ?? null,
        lastActiveAt: sessionMap.get(ws.name)?.lastActiveAt.getTime() ?? 0,
        hasSession: sessionMap.has(ws.name),
      }));

      items.sort((a, b) => {
        if (a.hasSession && b.hasSession) return b.lastActiveAt - a.lastActiveAt;
        if (a.hasSession) return -1;
        if (b.hasSession) return 1;
        return 0;
      });

      const { workspaceName } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'workspaceName',
          message: 'Select workspace to navigate to:',
          source: async (_answersSoFar: any, input: string | undefined) => {
            const searchInput = input || '';
            const source = items.map(item => ({
              name: `${item.name}  ${item.lastActiveLabel ? colorize(item.lastActiveLabel, 'dim') : colorize('no session', 'dim')}  ${colorize(`${item.repoCount} repos`, 'dim')}`,
              value: item.name,
            }));
            if (!searchInput) return source;
            const results = fuzzy.filter(searchInput, items, { extract: (item) => item.name });
            return results.map(result => ({
              name: `${result.original.name}  ${result.original.lastActiveLabel ? colorize(result.original.lastActiveLabel, 'dim') : colorize('no session', 'dim')}  ${colorize(`${result.original.repoCount} repos`, 'dim')}`,
              value: result.original.name,
            }));
          },
          pageSize: 15,
        } as any,
      ]);

      selectedWorkspace = workspaceName;
    }

    const workspacePath = path.join(WORKSPACES_DIR, selectedWorkspace);

    try {
      await fs.access(workspacePath);
    } catch {
      logError(`Workspace not found: ${selectedWorkspace}`);
      process.exit(1);
    }

    await fs.writeFile(TEMP_FILE, workspacePath, 'utf-8');

    const sessions = await getWorkspaceSessions();
    const session = sessions.find(s => s.workspaceName === selectedWorkspace);
    if (session) {
      // Write JSON with session ID and agent type for correct resume
      await fs.writeFile(RESUME_FLAG_FILE, JSON.stringify({
        sessionId: session.sessionId,
        agentType: session.agentType,
      }), 'utf-8');
    }

    console.log(workspacePath);
  } catch (error) {
    logError('Failed to navigate to workspace');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
