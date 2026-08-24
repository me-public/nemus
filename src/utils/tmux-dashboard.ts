import { spawnSync } from 'child_process';
import { AgentState, DASHBOARD_DEFAULTS } from '../types/dashboard';

const { sessionName } = DASHBOARD_DEFAULTS;

export const HIDDEN_WINDOW = `${sessionName}:1`;

export interface PaneInfo {
  index: string;
  pid: number;
}

/**
 * Get agent panes in the main dashboard window (excludes sidebar pane 0).
 */
export function getAgentPanes(): PaneInfo[] {
  const result = spawnSync('tmux', [
    'list-panes', '-t', sessionName, '-F',
    '#{pane_index} #{pane_pid}',
  ], { stdio: 'pipe' });

  if (!result.stdout) return [];
  return result.stdout.toString().trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [index, pid] = line.split(' ');
      return { index, pid: parseInt(pid, 10) || 0 };
    })
    .filter(p => p.index !== '0');
}

/**
 * Get panes from the hidden window (window 1) used during zoom.
 */
export function getHiddenPanes(): PaneInfo[] {
  const result = spawnSync('tmux', [
    'list-panes', '-t', HIDDEN_WINDOW, '-F',
    '#{pane_index} #{pane_pid}',
  ], { stdio: 'pipe' });

  if (!result.stdout) return [];
  return result.stdout.toString().trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [index, pid] = line.split(' ');
      return { index, pid: parseInt(pid, 10) || 0 };
    });
}

/**
 * Find the tmux pane matching an agent by PID (direct match only).
 */
export function findPaneForAgent(agent: AgentState, panes: PaneInfo[]): PaneInfo | null {
  return panes.find(p => p.pid === agent.pid) ?? null;
}

/**
 * Sort agents to match tmux pane order (top-to-bottom) by PID.
 */
export function sortAgentsByPaneOrder(agents: AgentState[], panes: PaneInfo[]): AgentState[] {
  const pidToIndex = new Map<number, number>();
  panes.forEach((p, i) => pidToIndex.set(p.pid, i));
  return [...agents].sort((a, b) => {
    const aIdx = pidToIndex.get(a.pid) ?? 999;
    const bIdx = pidToIndex.get(b.pid) ?? 999;
    return aIdx - bIdx;
  });
}

/**
 * Sort agents by an explicit PID order array (used during zoom to
 * preserve the original order regardless of current pane positions).
 */
export function sortAgentsByPidOrder(agents: AgentState[], pidOrder: number[]): AgentState[] {
  const pidToIndex = new Map<number, number>();
  pidOrder.forEach((pid, i) => pidToIndex.set(pid, i));
  return [...agents].sort((a, b) => {
    const aIdx = pidToIndex.get(a.pid) ?? 999;
    const bIdx = pidToIndex.get(b.pid) ?? 999;
    return aIdx - bIdx;
  });
}

/**
 * Restore all panes from the hidden window back to the main window,
 * then reorder them to match the given original PID order.
 */
export function restoreHiddenPanes(originalPidOrder?: number[]): void {
  // First, bring all hidden panes back (order may be wrong)
  for (let i = 0; i < 20; i++) {
    const winCheck = spawnSync('tmux', [
      'list-windows', '-t', sessionName, '-F', '#{window_index}',
    ], { stdio: 'pipe' });
    if (!winCheck.stdout || !winCheck.stdout.toString().split('\n').some(l => l.trim() === '1')) break;

    const hidden = getHiddenPanes();
    if (hidden.length === 0) break;

    const result = spawnSync('tmux', [
      'join-pane', '-d',
      '-s', `${HIDDEN_WINDOW}.${hidden[0].index}`,
      '-t', `${sessionName}:0`,
    ], { stdio: 'pipe' });

    if (result.status !== 0) break;
  }

  // If we have a desired order, reorder panes by swapping them into place
  if (originalPidOrder && originalPidOrder.length > 0) {
    reorderPanesByPid(originalPidOrder);
  }
}

/**
 * Reorder agent panes to match the given PID order using swap-pane.
 * Uses a simple selection sort: for each position, find the pane with
 * the correct PID and swap it into place.
 */
function reorderPanesByPid(desiredPidOrder: number[]): void {
  for (let i = 0; i < desiredPidOrder.length; i++) {
    const targetPid = desiredPidOrder[i];
    const currentPanes = getAgentPanes();

    // Find the current index of the pane with the desired PID
    const currentIdx = currentPanes.findIndex(p => p.pid === targetPid);
    if (currentIdx === -1) continue; // pane not found (maybe died)

    // The pane that should be at position i
    const shouldBeAt = currentPanes[i];
    if (!shouldBeAt) continue;

    // If already in the right position, skip
    if (currentPanes[currentIdx].index === shouldBeAt.index) continue;

    // Swap the pane at position i with the pane that has the correct PID
    spawnSync('tmux', [
      'swap-pane',
      '-s', `${sessionName}:0.${currentPanes[currentIdx].index}`,
      '-t', `${sessionName}:0.${shouldBeAt.index}`,
    ], { stdio: 'pipe' });
  }
}

/**
 * Reset to normal layout: restore hidden panes + rebalance.
 */
export function resetLayout(): void {
  restoreHiddenPanes();
  spawnSync('tmux', ['select-layout', '-t', sessionName, 'main-vertical'], { stdio: 'pipe' });
  spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });
  spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.0`], { stdio: 'pipe' });
}

/**
 * Zoom: hide all other agent panes to a hidden window.
 * First pane: break-pane (creates window 1).
 * Subsequent panes: join-pane into existing window 1.
 */
export function zoomPane(targetPane: PaneInfo): void {
  const targetPid = targetPane.pid;
  let hiddenWindowExists = false;

  const winCheck = spawnSync('tmux', [
    'list-windows', '-t', sessionName, '-F', '#{window_index}',
  ], { stdio: 'pipe' });
  if (winCheck.stdout && winCheck.stdout.toString().split('\n').some(l => l.trim() === '1')) {
    hiddenWindowExists = true;
  }

  for (let i = 0; i < 20; i++) {
    const currentPanes = getAgentPanes();
    const toHide = currentPanes.find(p => p.pid !== targetPid);
    if (!toHide) break;

    if (!hiddenWindowExists) {
      spawnSync('tmux', [
        'break-pane', '-d',
        '-s', `${sessionName}:0.${toHide.index}`,
      ], { stdio: 'pipe' });
      hiddenWindowExists = true;
    } else {
      spawnSync('tmux', [
        'join-pane', '-d',
        '-s', `${sessionName}:0.${toHide.index}`,
        '-t', HIDDEN_WINDOW,
      ], { stdio: 'pipe' });
    }
  }

  spawnSync('tmux', ['select-layout', '-t', `${sessionName}:0`, 'main-vertical'], { stdio: 'pipe' });
  spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });
  spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.0`], { stdio: 'pipe' });
}
