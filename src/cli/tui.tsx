#!/usr/bin/env node
// TUI implementation - simplified version without ink for now
// Full ink-based implementation can be added after dependencies are installed

import { listWorkspaces } from '../utils/workspace-meta';
import { logError, logInfo } from '../utils/logger';
import { colorize } from '../utils/colors';

export const main = async () => {
  try {
    logInfo('Interactive TUI mode');
    console.log(colorize('\n╔══════════════════════════════════════════╗', 'cyan'));
    console.log(colorize('║    Workspace Manager - Interactive UI   ║', 'cyan'));
    console.log(colorize('╚══════════════════════════════════════════╝\n', 'cyan'));

    const workspaces = await listWorkspaces();

    if (workspaces.length === 0) {
      logError('No workspaces found');
      console.log(colorize('Create a workspace with: workspace create', 'gray'));
      process.exit(1);
    }

    console.log(colorize('Available Workspaces:', 'bright'));
    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      const repoCount = ws.metadata?.repositories.length || 0;
      console.log(`  ${i + 1}. ${colorize(ws.name, 'cyan')} (${repoCount} repos)`);
    }

    console.log('\n' + colorize('Commands:', 'bright'));
    console.log('  workspace status <name>    - Check git status');
    console.log('  workspace doctor <name>    - Run health checks');
    console.log('  workspace sync <name>      - Pull latest changes');
    console.log('  wgo <name>                 - Navigate to workspace');
    console.log('');

    logInfo('Full interactive TUI with ink will be available after running: npm install');
  } catch (error) {
    logError('TUI failed');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
};

// Auto-execute only when run directly (not when imported by Commander)
if (require.main === module) {
  main();
}
