import { spawnSync } from 'child_process';
import { DASHBOARD_DEFAULTS } from '../../types/dashboard';

const { sessionName } = DASHBOARD_DEFAULTS;

/**
 * Launch an agent in the dashboard by spawning a new tmux pane.
 * Kills any placeholder pane (sleep infinity), splits a new pane,
 * and rebalances the layout.
 *
 * @param workspacePath - absolute path to the workspace directory
 * @param command - shell command to run in the new pane (e.g. 'claude' or 'claude --resume <id> --fork-session')
 */
export function launchAgentPane(workspacePath: string, command: string): void {
  // Kill placeholder pane (sleep infinity) if present
  const paneResult = spawnSync('tmux', [
    'list-panes', '-t', sessionName, '-F',
    '#{pane_index} #{pane_current_command}',
  ], { stdio: 'pipe' });

  if (paneResult.stdout) {
    const lines = paneResult.stdout.toString().trim().split('\n');
    for (const line of lines) {
      const parts = line.split(' ');
      if (parts[0] !== '0' && parts.slice(1).join(' ').includes('sleep')) {
        spawnSync('tmux', ['kill-pane', '-t', `${sessionName}:0.${parts[0]}`], { stdio: 'pipe' });
        break;
      }
    }
  }

  // Create a new pane for the agent
  spawnSync('tmux', [
    'split-window', '-t', `${sessionName}:0`, '-h',
    '-c', workspacePath,
    command,
  ], { stdio: 'pipe' });

  // Rebalance layout: sidebar left, agents stacked right
  spawnSync('tmux', ['select-layout', '-t', sessionName, 'main-vertical'], { stdio: 'pipe' });
  spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });
}
