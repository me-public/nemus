import * as React from 'react';
import { AgentState, InkComponents } from './types';
import { StatusBadge } from './StatusBadge';

interface AgentListProps extends InkComponents {
  agents: AgentState[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export const AgentList: React.FC<AgentListProps> = ({ agents, selectedIndex, onSelect, Box, Text }) => {
  if (agents.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No agents running</Text>
        <Text dimColor>Press n to launch</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {agents.map((agent, i) => {
        const isSelected = i === selectedIndex;
        const ws = agent.workspace.length > 13
          ? agent.workspace.slice(0, 12) + '…'
          : agent.workspace;
        const num = `${i + 1}`;

        return (
          <Box key={agent.sessionId} gap={1}>
            {isSelected ? (
              <Text backgroundColor="blue" color="white" bold>▸{num}</Text>
            ) : (
              <Text dimColor> {num}</Text>
            )}
            <Text color="cyan" bold={isSelected}>{ws.padEnd(13)}</Text>
            <StatusBadge status={agent.status} Box={Box} Text={Text} />
          </Box>
        );
      })}
    </Box>
  );
};
