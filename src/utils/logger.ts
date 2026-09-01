import { colors, colorize } from './colors';

// Diagnostics (info/success/error/warn/step) go to STDERR so stdout carries only
// a command's actual data — required for clean `--json` piping (nemus list
// --json | jq …) and for non-TTY consumers. Use `outputJson`/stdout for data.
const logStream = (line: string): void => console.error(line);

// `--quiet` silences routine progress (info/success/step) while KEEPING warnings
// and errors, which a script or human still needs to see.
let quiet = false;
export const setQuiet = (on: boolean): void => {
  quiet = on;
};
export const isQuiet = (): boolean => quiet;

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
  if (quiet) return;
  logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${message}`);
};

export const logSuccess = (message: string): void => {
  if (quiet) return;
  logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('✓', 'green')} ${message}`);
};

export const logError = (message: string): void => {
  logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('✗', 'red')} ${message}`);
};

export const logWarning = (message: string): void => {
  logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('⚠', 'yellow')} ${message}`);
};

export const logStep = (stepOrMessage: number | string, total?: number, message?: string): void => {
  if (quiet) return;
  if (typeof stepOrMessage === 'string') {
    // Single parameter version: just a message
    logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize('▸', 'cyan')} ${stepOrMessage}`);
  } else {
    // Three parameter version: step, total, message
    logStream(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colorize(`[${stepOrMessage}/${total}]`, 'cyan')} ${message}`);
  }
};
