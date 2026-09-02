#!/usr/bin/env node
/**
 * Session resume picker for the agent dashboard.
 * Shows recent sessions sorted by last active, launches
 * the appropriate agent CLI with --resume <id> --fork in a new dashboard pane.
 */

import { getWorkspaceSessions, WorkspaceSession } from '../../utils/claude-sessions';
import { launchAgentPane } from './launcher';
import { getAgentPaths, getPrimaryAgent, ConcreteAgentType } from '../../utils/agent-config';
import { colorize } from '../../utils/colors';
import { search } from '../../utils/prompt';
import * as fuzzy from 'fuzzy';

async function main() {
  try {
    const sessions = await getWorkspaceSessions();

    if (sessions.length === 0) {
      console.log('No sessions found. Launch a new agent with n.');
      process.exit(1);
    }

    const items = sessions.map(session => ({
      session,
      displayName: session.workspaceName,
      timeLabel: session.lastActiveLabel,
    }));

    const selected = await search<typeof items[number]>({
      message: 'Select session to resume:',
      pageSize: 15,
      source: async (term: string | undefined) => {
        const searchInput = term || '';
        const source = items.map(item => ({
          name: `${item.displayName}  ${colorize(item.timeLabel, 'dim')}`,
          value: item,
        }));
        if (!searchInput) return source;
        const results = fuzzy.filter(searchInput, items, { extract: (item) => item.displayName });
        return results.map(result => ({
          name: `${result.original.displayName}  ${colorize(result.original.timeLabel, 'dim')}`,
          value: result.original,
        }));
      },
    });

    const item = selected as { session: WorkspaceSession };
    const session = item.session;
    const rawSessionId = session.sessionId;
    // Sanitize session ID before interpolating into shell command
    if (!/^[a-zA-Z0-9\-]{1,100}$/.test(rawSessionId)) {
      console.error('Invalid session ID format — skipping');
      process.exit(1);
    }
    // Use the session's agent type for resume, fall back to primary if missing
    // (sessions from before the multi-agent upgrade won't have agentType)
    const agentType = session.agentType || getPrimaryAgent().type;
    const agent = getAgentPaths(agentType as ConcreteAgentType);
    launchAgentPane(session.workspacePath, agent.resumeCommand(rawSessionId));
    console.log(`\nResuming ${agentType} session in ${session.workspaceName}`);
  } catch (error) {
    if ((error as any)?.name === 'ExitPromptError') process.exit(0);
    process.exit(1);
  }
}

main();
