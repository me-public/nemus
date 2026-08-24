import { Command } from 'commander';
import { execFileSync, spawnSync } from 'child_process';
import * as path from 'path';
import { logError, logInfo, logSuccess } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { areDashboardHooksInstalled, installDashboardHooks, uninstallDashboardHooks } from '../../utils/dashboard-hooks';
import { DASHBOARD_DEFAULTS } from '../../types/dashboard';
import { readAllAgentStates, removeAgentState } from '../../utils/agent-state';
import { getAgentPanes, findPaneForAgent, resetLayout } from '../../utils/tmux-dashboard';
import { getPrimaryAgent } from '../../utils/agent-config';

const { sessionName, sidebarWidthPercent } = DASHBOARD_DEFAULTS;

function isTmuxAvailable(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export function registerDashboardCommand(parent: Command) {
  parent
    .command('dashboard')
    .alias('dash')
    .description('Launch multi-agent management dashboard')
    .option('--install-hooks', 'Install Claude status hooks without launching dashboard')
    .option('--uninstall-hooks', 'Remove dashboard hooks from Claude settings')
    .option('--list', 'List running agents as JSON (non-interactive)')
    .option('--status', 'Show agent status summary (non-interactive)')
    .option('--kill <sessionId>', 'Kill agent by session ID (non-interactive)')
    .option('--launch <workspace>', 'Launch a new agent in a workspace (non-interactive)')
    .action(async (opts) => {
      await handleDashboard(opts);
    });
}

async function handleDashboard(opts: {
  installHooks?: boolean;
  uninstallHooks?: boolean;
  list?: boolean;
  status?: boolean;
  kill?: string;
  launch?: string;
}) {
  // Handle hook-only commands
  if (opts.installHooks) {
    installDashboardHooks();
    logSuccess('Dashboard hooks installed in ~/.claude/settings.json');
    return;
  }

  if (opts.uninstallHooks) {
    uninstallDashboardHooks();
    logSuccess('Dashboard hooks removed from ~/.claude/settings.json');
    return;
  }

  // --list: print running agents as JSON
  if (opts.list) {
    const agents = readAllAgentStates().filter(a => a.status !== 'stopped');
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  // --status: human-readable status summary
  if (opts.status) {
    const agents = readAllAgentStates().filter(a => a.status !== 'stopped');
    if (agents.length === 0) {
      console.log('No agents running.');
      return;
    }
    for (const a of agents) {
      console.log(`${colorize(a.workspace, 'cyan')}  ${colorize(a.status, 'yellow')}  ${a.sessionId.slice(0, 8)}`);
    }
    return;
  }

  // --kill: kill agent by session ID
  if (opts.kill) {
    const sessionId = opts.kill;
    const agents = readAllAgentStates();
    const agent = agents.find(a => a.sessionId === sessionId || a.sessionId.startsWith(sessionId));
    if (!agent) {
      logError(`No agent found with session ID: ${sessionId}`);
      process.exit(1);
    }
    // Try to kill the tmux pane if dashboard is running
    const panes = getAgentPanes();
    const pane = findPaneForAgent(agent, panes);
    if (pane) {
      spawnSync('tmux', ['kill-pane', '-t', `${sessionName}:0.${pane.index}`], { stdio: 'pipe' });
      setTimeout(() => resetLayout(), 100);
    } else {
      // Kill the process directly (guard: pid 0 would kill entire process group)
      if (agent.pid > 0) {
        try { process.kill(agent.pid); } catch { /* already dead */ }
      }
    }
    removeAgentState(agent.sessionId);
    logSuccess(`Killed agent: ${agent.workspace} (${agent.sessionId.slice(0, 8)})`);
    return;
  }

  // --launch: launch a new agent in a workspace
  if (opts.launch) {
    const workspaceName = opts.launch;
    const { listWorkspaces } = await import('../../utils/workspace-meta');
    const workspaces = await listWorkspaces();
    const ws = workspaces.find(w => w.name === workspaceName);
    if (!ws) {
      logError(`Workspace not found: ${workspaceName}`);
      logInfo(`Available: ${workspaces.map(w => w.name).join(', ')}`);
      process.exit(1);
    }
    // Check if dashboard is running by verifying the session exists
    const sessionCheck = spawnSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' });
    if (sessionCheck.status === 0) {
      // Dashboard running — split a pane
      spawnSync('tmux', [
        'split-window', '-t', `${sessionName}:0`, '-h',
        '-c', ws.path,
        getPrimaryAgent().launchCommand,
      ], { stdio: 'pipe' });
      spawnSync('tmux', ['select-layout', '-t', sessionName, 'main-vertical'], { stdio: 'pipe' });
      spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });
      logSuccess(`Launched agent in workspace: ${workspaceName}`);
    } else {
      logInfo(`Dashboard not running. Start it with: w dash`);
    }
    return;
  }

  // Check tmux for interactive dashboard
  if (!isTmuxAvailable()) {
    logError('tmux is required for the agent dashboard');
    console.log(colorize('Install tmux: brew install tmux', 'gray'));
    process.exit(1);
  }

  // Auto-install hooks if not present
  if (!areDashboardHooksInstalled()) {
    installDashboardHooks();
    logInfo('Installed dashboard hooks in ~/.claude/settings.json');
  }

  // Check if dashboard session already exists — reconnect if so
  const sessionExists = spawnSync('tmux', [
    'has-session', '-t', sessionName,
  ], { stdio: 'pipe' }).status === 0;

  if (sessionExists) {
    logInfo('Reconnecting to existing dashboard session...');
    if (isInsideTmux()) {
      spawnSync('tmux', ['switch-client', '-t', sessionName], { stdio: 'inherit' });
    } else {
      spawnSync('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit' });
    }
    logSuccess('Dashboard session ended');
    return;
  }

  // Resolve paths to compiled scripts
  const sidebarScript = path.join(__dirname, 'sidebar.js');

  // Create tmux session with sidebar in the left pane
  const newSessionResult = spawnSync('tmux', [
    'new-session', '-d', '-s', sessionName,
    '-x', '200', '-y', '50',
    `node "${sidebarScript}"`,
  ], { stdio: 'pipe' });

  if (newSessionResult.status !== 0) {
    logError('Failed to create tmux session');
    const stderr = newSessionResult.stderr?.toString();
    if (stderr) logError(stderr);
    process.exit(1);
  }

  // Split right pane (80%) with placeholder message
  spawnSync('tmux', [
    'split-window', '-h', '-t', sessionName,
    '-p', String(100 - sidebarWidthPercent),
    'bash', '-c',
    'echo ""; echo "  No agents running."; echo "  Press n in the sidebar to launch an agent."; echo ""; sleep infinity',
  ], { stdio: 'pipe' });

  // Focus the sidebar pane (left)
  spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.0`], { stdio: 'pipe' });

  // ── Session-scoped key bindings ──
  // Use set-hook to add bindings only while this session is active and
  // restore them on detach — avoids polluting global tmux key tables.
  // prefix + M → focus sidebar + reset layout (M chosen to avoid overriding standard keys)
  spawnSync('tmux', [
    'set-hook', '-t', sessionName, 'session-created',
    `bind-key -T prefix M run-shell "tmux select-layout -t ${sessionName} main-vertical \\\\; resize-pane -t ${sessionName}:0.0 -x 32 \\\\; select-pane -t ${sessionName}:0.0"`,
  ], { stdio: 'pipe' });

  // Bind immediately for the current session
  spawnSync('tmux', [
    'bind-key', '-T', 'prefix', 'M',
    'run-shell',
    `tmux select-layout -t ${sessionName} main-vertical \\; resize-pane -t ${sessionName}:0.0 -x 32 \\; select-pane -t ${sessionName}:0.0`,
  ], { stdio: 'pipe' });

  // Unbind prefix+M when the dashboard session ends (cleanup)
  spawnSync('tmux', [
    'set-hook', '-t', sessionName, 'session-closed',
    'unbind-key -T prefix M',
  ], { stdio: 'pipe' });

  // ── Status bar ──
  spawnSync('tmux', [
    'set-option', '-t', sessionName,
    'status-left', ' 🤖 Agent Dashboard ',
  ], { stdio: 'pipe' });
  spawnSync('tmux', [
    'set-option', '-t', sessionName,
    'status-right', ' prefix+M:sidebar/reset  q:detach  Q:quit ',
  ], { stdio: 'pipe' });
  spawnSync('tmux', [
    'set-option', '-t', sessionName,
    'status-style', 'bg=colour235,fg=colour255',
  ], { stdio: 'pipe' });

  // Enable mouse support for pane selection
  spawnSync('tmux', [
    'set-option', '-t', sessionName,
    'mouse', 'on',
  ], { stdio: 'pipe' });

  logInfo('Launching agent dashboard...');

  // Attach to the session
  if (isInsideTmux()) {
    spawnSync('tmux', ['switch-client', '-t', sessionName], { stdio: 'inherit' });
  } else {
    spawnSync('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit' });
  }

  logSuccess('Agent dashboard session ended');
}
