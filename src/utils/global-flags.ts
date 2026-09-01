import { setColorEnabled } from './colors';
import { setQuiet } from './logger';

/** Global options commander parses off the root program. */
export interface GlobalFlagOpts {
  /** commander's negatable `--no-color` yields `color: false` when passed. */
  color?: boolean;
  /** `-q`/`--quiet`, including bundled short forms like `-yq`. */
  quiet?: boolean;
}

/**
 * Apply parsed global flags to process-wide state. Kept pure over injected
 * setters so it's testable without commander — the `preAction` hook in
 * program.ts is a one-line call into this. Only ever turns features OFF here:
 * color defaults on (and env/TTY detection already ran at import), so we act
 * solely on an explicit `--no-color` (`color === false`).
 */
export function applyGlobalFlags(
  opts: GlobalFlagOpts,
  deps: { setColorEnabled: (on: boolean) => void; setQuiet: (on: boolean) => void } = {
    setColorEnabled,
    setQuiet,
  },
): void {
  if (opts.color === false) deps.setColorEnabled(false);
  if (opts.quiet) deps.setQuiet(true);
}
