/**
 * Shared types for ink dashboard components.
 * ink components are passed as props to avoid direct ESM imports
 * (ink v5 is ESM-only; the project uses CJS).
 */
import { FC } from 'react';
import { BoxProps, TextProps, Key } from 'ink';
import { AgentState, AgentStatus } from '../../types/dashboard';

/** ink components passed through from the dynamic import bridge */
export interface InkComponents {
  Box: FC<BoxProps>;
  Text: FC<TextProps>;
}

export type { AgentState, AgentStatus, Key };
