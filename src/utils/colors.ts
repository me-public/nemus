// ANSI escape codes. `colors` starts as a copy of these but is emptied in place
// when color is disabled (--no-color / NO_COLOR / non-TTY), so BOTH `colorize()`
// and inline `colors.x` template usage go plain without touching call sites.
const ANSI = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

export type ColorName = keyof typeof ANSI;

// Live map read at every use. Mutated in place by setColorEnabled so previously
// imported references (e.g. `colors.gray` inside a template) see the change.
export const colors: Record<ColorName, string> = { ...ANSI };

let enabled = true;

/** Whether colored output is currently on. */
export const isColorEnabled = (): boolean => enabled;

/** Turn color on/off. When off, every `colors.*` code becomes '' so output is
 *  plain; when on, the ANSI codes are restored. */
export function setColorEnabled(on: boolean): void {
  enabled = on;
  for (const key of Object.keys(ANSI) as ColorName[]) {
    colors[key] = on ? ANSI[key] : '';
  }
}

/**
 * Decide whether to use color by default, following the common conventions:
 * - `NO_COLOR` (any value, even empty) disables — see https://no-color.org
 * - `FORCE_COLOR` (and not "0"/"false") forces it on, even when not a TTY
 * - otherwise on only when the stdout stream is a TTY and `TERM` isn't `dumb`
 */
export function detectColorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = !!process.stdout.isTTY,
): boolean {
  if ('NO_COLOR' in env) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== '' && force !== '0' && force.toLowerCase() !== 'false') {
    return true;
  }
  if (env.TERM === 'dumb') return false;
  return isTTY;
}

export const colorize = (text: string, color: ColorName): string => {
  return `${colors[color]}${text}${colors.reset}`;
};

// Apply the environment default at import time so NO_COLOR / a non-TTY pipe is
// respected even before any CLI flag is parsed (an explicit --no-color / --color
// flag overrides this later).
setColorEnabled(detectColorEnabled());
