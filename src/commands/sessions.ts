import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { getWorkspaceSessions, WorkspaceSession } from '../utils/claude-sessions';
import { listWorkspaces } from '../utils/workspace-meta';
import { logError, logInfo } from '../utils/logger';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import * as fuzzy from 'fuzzy';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

const TEMP_FILE = path.join(os.homedir(), '.workspace-last-go');
const RESUME_FLAG_FILE = path.join(os.homedir(), '.workspace-resume-session');

export function registerSessionsCommand(parent: Command) {
  parent
    .command('sessions')
    .alias('ses')
    .description('Resume a Claude session in a workspace')
    .action(async () => {
      await handleSessions();
    });
}

async function handleSessions() {
  try {
    const sessions = await getWorkspaceSessions();

    if (sessions.length === 0) {
      logInfo('No workspace sessions found.');
      console.log('\nYou can create a workspace with: nemus create');
      console.log('Or navigate to one with: w go');
      return;
    }

    const workspaces = await listWorkspaces(false);
    const workspaceMap = new Map(workspaces.map(ws => [ws.name, ws]));

    const items = sessions.map(session => {
      const ws = workspaceMap.get(session.workspaceName);
      const repoCount = ws?.metadata?.repositories?.length ?? 0;
      const repoLabel = repoCount > 0 ? `${repoCount} repos` : 'no repos';
      return { session, repoLabel };
    });

    const maxNameLen = Math.max(...items.map(i => i.session.workspaceName.length));

    console.log('');
    console.log(colorize('  Workspace Sessions', 'bright') + colorize('  (sorted by last active)', 'dim'));
    console.log(colorize('  ' + '─'.repeat(50), 'dim'));

    for (const item of items.slice(0, 10)) {
      const name = item.session.workspaceName.padEnd(maxNameLen);
      const time = item.session.lastActiveLabel;
      console.log(`  ${colorize(name, 'cyan')}  ${colorize(time, 'yellow')}  ${colorize(item.repoLabel, 'dim')}`);
    }
    if (items.length > 10) {
      console.log(colorize(`  ... and ${items.length - 10} more`, 'dim'));
    }
    console.log('');

    const { selected } = await inquirer.prompt([{
      type: 'autocomplete', name: 'selected',
      message: 'Select workspace to resume:',
      source: async (_answersSoFar: any, input: string | undefined) => {
        const searchInput = input || '';
        const source = items.map(item => ({
          name: `${item.session.workspaceName}  ${colorize(item.session.lastActiveLabel, 'dim')}  ${colorize(item.repoLabel, 'dim')}`,
          value: item.session,
        }));
        if (!searchInput) return source;
        const results = fuzzy.filter(searchInput, items, { extract: (item) => item.session.workspaceName });
        return results.map(result => ({
          name: `${result.original.session.workspaceName}  ${colorize(result.original.session.lastActiveLabel, 'dim')}  ${colorize(result.original.repoLabel, 'dim')}`,
          value: result.original.session,
        }));
      },
      pageSize: 15,
    } as any]);

    const session = selected as WorkspaceSession;
    await fs.writeFile(TEMP_FILE, session.workspacePath, 'utf-8');
    // Write JSON with session ID and agent type for correct resume
    await fs.writeFile(RESUME_FLAG_FILE, JSON.stringify({
      sessionId: session.sessionId,
      agentType: session.agentType,
    }), 'utf-8');

    console.log(`\n${colorize('Resuming:', 'green')} ${session.workspaceName} (last active ${session.lastActiveLabel})`);
  } catch (error) {
    if ((error as any)?.name === 'ExitPromptError') return;
    logError('Failed to list sessions');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
