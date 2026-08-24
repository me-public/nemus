#!/usr/bin/env node
/**
 * Workspace picker for the agent dashboard.
 * Runs inside a tmux popup — lets the user select a workspace,
 * then spawns a fresh claude agent pane in the dashboard session.
 */

import { listWorkspaces } from '../../utils/workspace-meta';
import { launchAgentPane } from './launcher';
import { getPrimaryAgent } from '../../utils/agent-config';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import * as fuzzy from 'fuzzy';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

async function main() {
  try {
    const workspaces = await listWorkspaces();

    if (workspaces.length === 0) {
      console.log('No workspaces found. Create one with: workspace create');
      process.exit(1);
    }

    const items = workspaces.map(ws => ({
      name: ws.name,
      path: ws.path,
      repoCount: ws.metadata?.repositories?.length ?? 0,
    }));

    const { selected } = await inquirer.prompt([{
      type: 'autocomplete',
      name: 'selected',
      message: 'Select workspace to launch agent in:',
      source: async (_answersSoFar: any, input: string | undefined) => {
        const searchInput = input || '';
        const source = items.map(item => ({
          name: `${item.name}  (${item.repoCount} repos)`,
          value: item,
        }));
        if (!searchInput) return source;
        const results = fuzzy.filter(searchInput, items, { extract: (item) => item.name });
        return results.map(result => ({
          name: `${result.original.name}  (${result.original.repoCount} repos)`,
          value: result.original,
        }));
      },
      pageSize: 15,
    } as any]);

    const workspace = selected as { name: string; path: string };
    const agent = getPrimaryAgent();
    launchAgentPane(workspace.path, agent.launchCommand);
    console.log(`\nLaunched agent in ${workspace.name}`);
  } catch (error) {
    if ((error as any)?.name === 'ExitPromptError') process.exit(0);
    process.exit(1);
  }
}

main();
