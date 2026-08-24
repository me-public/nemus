import { colors, colorize } from './colors';

const getTimestamp = (): string => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const logInfo = (message: string): void => {
  console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${message}`);
};

export const logSuccess = (message: string): void => {
  console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('✓', 'green')} ${message}`);
};

export const logError = (message: string): void => {
  console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('✗', 'red')} ${message}`);
};

export const logWarning = (message: string): void => {
  console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('⚠', 'yellow')} ${message}`);
};

export const logStep = (stepOrMessage: number | string, total?: number, message?: string): void => {
  if (typeof stepOrMessage === 'string') {
    // Single parameter version: just a message
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('▸', 'cyan')} ${stepOrMessage}`);
  } else {
    // Three parameter version: step, total, message
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize(`[${stepOrMessage}/${total}]`, 'cyan')} ${message}`);
  }
};
