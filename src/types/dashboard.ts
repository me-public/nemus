export type AgentStatus = 'idle' | 'working' | 'waiting' | 'stopped';

export interface AgentState {
  sessionId: string;
  workspace: string;
  workspacePath: string;
  pid: number;
  status: AgentStatus;
  startedAt: string;
  lastUpdatedAt: string;
  tmuxPane?: string;
}

export interface DashboardConfig {
  sessionName: string;
  sidebarWidthPercent: number;
  pollIntervalMs: number;
  staleTtlMs: number;
}

export const DASHBOARD_DEFAULTS: DashboardConfig = {
  sessionName: 'ws-dashboard',
  sidebarWidthPercent: 20,
  pollIntervalMs: 2000,
  staleTtlMs: 300_000,
};

/** Marker string embedded in hook commands for detection/removal */
export const HOOK_MARKER = 'workspace-dashboard-hook';
