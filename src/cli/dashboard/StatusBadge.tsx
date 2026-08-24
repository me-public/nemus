import * as React from 'react';
import { AgentStatus, InkComponents } from './types';

interface StatusBadgeProps extends InkComponents {
  status: AgentStatus;
}

const STATUS_CONFIG: Record<AgentStatus, { icon: string; color: string; label: string }> = {
  working: { icon: '●', color: 'green', label: 'working' },
  waiting: { icon: '●', color: 'yellow', label: 'approve' },
  idle:    { icon: '◌', color: 'gray', label: 'idle' },
  stopped: { icon: '✕', color: 'red', label: 'stopped' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, Box, Text }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  return (
    <Box gap={1}>
      <Text color={config.color}>{config.icon}</Text>
      <Text color={config.color}>{config.label}</Text>
    </Box>
  );
};
