import * as React from 'react';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { readAllAgentStates } from '../../utils/agent-state';
import { AgentState, DASHBOARD_DEFAULTS } from '../../types/dashboard';
import { InkComponents, Key } from './types';
import { AgentList } from './AgentList';
import { HelpFooter } from './HelpFooter';
import {
  getAgentPanes,
  getHiddenPanes,
  findPaneForAgent,
  sortAgentsByPaneOrder,
  sortAgentsByPidOrder,
  resetLayout,
  restoreHiddenPanes,
  zoomPane,
} from '../../utils/tmux-dashboard';

const { sessionName, pollIntervalMs } = DASHBOARD_DEFAULTS;

export interface DashboardSidebarProps extends InkComponents {
  useInput: (handler: (input: string, key: Key) => void) => void;
  useApp: () => { exit: (error?: Error) => void };
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({ Box, Text, useInput, useApp }) => {
  const [agents, setAgents] = React.useState<AgentState[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [isZoomed, setIsZoomed] = React.useState(false);
  const { exit } = useApp();

  // Refs for always-current values inside the useInput closure
  const agentsRef = React.useRef<AgentState[]>([]);
  const selectedIndexRef = React.useRef(0);
  const isZoomedRef = React.useRef(false);
  // Store original pane PID order before zoom so we can restore it
  const originalPaneOrderRef = React.useRef<number[]>([]);

  // Poll agent states every 2s
  React.useEffect(() => {
    function refresh() {
      const visiblePanes = getAgentPanes();
      const hiddenPanes = getHiddenPanes();
      const allPanes = [...visiblePanes, ...hiddenPanes];
      const panePids = new Set(allPanes.map(p => p.pid));

      const allStates = readAllAgentStates().filter(s => {
        if (s.status === 'stopped') return false;
        return panePids.has(s.pid);
      });

      // When zoomed, sort by the original pane order so the sidebar
      // display stays stable (zoomed pane doesn't jump to the top)
      const originalOrder = originalPaneOrderRef.current;
      let sorted: AgentState[];
      if (originalOrder.length > 0) {
        sorted = sortAgentsByPidOrder(allStates, originalOrder);
      } else {
        sorted = sortAgentsByPaneOrder(allStates, allPanes);
      }

      agentsRef.current = sorted;
      setAgents(sorted);
    }
    refresh();
    const timer = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(timer);
  }, []);

  // Keep selectedIndex ref in sync
  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // Keep isZoomed ref in sync
  React.useEffect(() => {
    isZoomedRef.current = isZoomed;
  }, [isZoomed]);

  // Clamp selection — handles both too-high and negative values
  const clampedIndex = Math.min(Math.max(selectedIndex, 0), Math.max(0, agents.length - 1));
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex);
    selectedIndexRef.current = clampedIndex;
  }

  /**
   * Apply zoom to a specific agent index.
   */
  function applyZoom(agentIndex: number): void {
    const currentAgents = agentsRef.current;
    if (agentIndex >= currentAgents.length) return;

    if (isZoomedRef.current) {
      // Already zoomed — restore panes in original order, then re-zoom
      restoreHiddenPanes(originalPaneOrderRef.current);
    } else {
      // First zoom — capture the current pane order before hiding anything
      const panes = getAgentPanes();
      originalPaneOrderRef.current = panes.map(p => p.pid);
      restoreHiddenPanes(); // no-op if nothing hidden
    }

    spawnSync('tmux', ['select-layout', '-t', sessionName, 'main-vertical'], { stdio: 'pipe' });
    spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });

    const panes = getAgentPanes();
    const pane = findPaneForAgent(currentAgents[agentIndex], panes);
    if (pane) {
      zoomPane(pane);
      setIsZoomed(true);
      isZoomedRef.current = true;
    }
  }

  /**
   * Unzoom and reset layout, restoring original pane order.
   */
  function unzoom(): void {
    restoreHiddenPanes(originalPaneOrderRef.current);
    originalPaneOrderRef.current = [];
    spawnSync('tmux', ['select-layout', '-t', sessionName, 'main-vertical'], { stdio: 'pipe' });
    spawnSync('tmux', ['resize-pane', '-t', `${sessionName}:0.0`, '-x', '32'], { stdio: 'pipe' });
    spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.0`], { stdio: 'pipe' });
    setIsZoomed(false);
    isZoomedRef.current = false;
  }

  // Keyboard handling — reads from refs for always-current data
  useInput((input: string, key: Key) => {
    const currentAgents = agentsRef.current;
    const currentIdx = selectedIndexRef.current;
    const currentZoomed = isZoomedRef.current;
    const clampedIdx = Math.min(Math.max(currentIdx, 0), Math.max(0, currentAgents.length - 1));

    // q — detach (session stays running in background, agents keep working)
    if (input === 'q') {
      restoreHiddenPanes();
      spawnSync('tmux', ['detach-client', '-s', sessionName], { stdio: 'pipe' });
      // Do NOT call exit() — the sidebar process must keep running so
      // the session is alive when the user re-attaches with 'w dash'
      return;
    }

    // Q (shift+q) — kill session and all agents
    if (input === 'Q') {
      restoreHiddenPanes();
      spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'pipe' });
      exit();
      return;
    }

    // Navigation
    if (key.upArrow || input === 'K') {
      const next = Math.max(0, clampedIdx - 1);
      setSelectedIndex(next);
      selectedIndexRef.current = next;
      return;
    }
    if (key.downArrow || input === 'J') {
      const next = Math.max(0, Math.min(currentAgents.length - 1, clampedIdx + 1));
      setSelectedIndex(next);
      selectedIndexRef.current = next;
      return;
    }

    // Number keys 1-9
    if (input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1;
      if (idx < currentAgents.length) {
        setSelectedIndex(idx);
        selectedIndexRef.current = idx;
      }
      return;
    }

    // Focus — switch to agent pane
    if (input === 'f' || key.return) {
      if (clampedIdx < currentAgents.length) {
        if (currentZoomed) {
          applyZoom(clampedIdx);
          const panes = getAgentPanes();
          const pane = findPaneForAgent(currentAgents[clampedIdx], panes);
          if (pane) {
            spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.${pane.index}`], { stdio: 'pipe' });
          }
        } else {
          const panes = getAgentPanes();
          const pane = findPaneForAgent(currentAgents[clampedIdx], panes);
          if (pane) {
            spawnSync('tmux', ['select-pane', '-t', `${sessionName}:0.${pane.index}`], { stdio: 'pipe' });
          }
        }
      }
      return;
    }

    // Zoom toggle
    if (input === 'z') {
      if (currentZoomed) {
        unzoom();
        isZoomedRef.current = false;
      } else {
        applyZoom(clampedIdx);
      }
      return;
    }

    // Reset layout
    if (input === 'r') {
      unzoom();
      isZoomedRef.current = false;
      return;
    }

    // New agent
    if (input === 'n') {
      if (currentZoomed) {
        unzoom();
        isZoomedRef.current = false;
      }
      const pickerScript = path.join(__dirname, '..', '..', 'commands', 'dashboard', 'workspace-picker.js');
      const popupResult = spawnSync('tmux', [
        'display-popup', '-E', '-w', '60%', '-h', '60%',
        '-t', sessionName,
        `node "${pickerScript}"`,
      ], { stdio: 'pipe' });

      if (popupResult.status !== 0) {
        spawnSync('tmux', ['split-window', '-t', sessionName, '-v', `node "${pickerScript}"`], { stdio: 'pipe' });
      }
      setTimeout(() => resetLayout(), 500);
      return;
    }

    // Resume session
    if (input === 's') {
      if (currentZoomed) {
        unzoom();
        isZoomedRef.current = false;
      }
      const sessionPickerScript = path.join(__dirname, '..', '..', 'commands', 'dashboard', 'session-picker.js');
      const popupResult = spawnSync('tmux', [
        'display-popup', '-E', '-w', '60%', '-h', '60%',
        '-t', sessionName,
        `node "${sessionPickerScript}"`,
      ], { stdio: 'pipe' });

      if (popupResult.status !== 0) {
        spawnSync('tmux', ['split-window', '-t', sessionName, '-v', `node "${sessionPickerScript}"`], { stdio: 'pipe' });
      }
      setTimeout(() => resetLayout(), 500);
      return;
    }

    // Kill / close session
    if (input === 'x') {
      if (clampedIdx < currentAgents.length) {
        if (currentZoomed) {
          unzoom();
          isZoomedRef.current = false;
        }
        const panes = getAgentPanes();
        const pane = findPaneForAgent(currentAgents[clampedIdx], panes);
        if (pane) {
          spawnSync('tmux', ['kill-pane', '-t', `${sessionName}:0.${pane.index}`], { stdio: 'pipe' });
          setTimeout(() => resetLayout(), 100);
        }
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{'─ Agent Dashboard ─'}</Text>
        {isZoomed && <Text color="yellow"> [ZOOM]</Text>}
      </Box>
      <AgentList
        agents={agents}
        selectedIndex={clampedIndex}
        onSelect={setSelectedIndex}
        Box={Box}
        Text={Text}
      />
      <HelpFooter isZoomed={isZoomed} Box={Box} Text={Text} />
    </Box>
  );
};
