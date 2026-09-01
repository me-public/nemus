import { spawnSync } from 'child_process';

/**
 * Resolve the user's preferred editor as an argv array. Honors `$VISUAL` then
 * `$EDITOR` (the long-standing Unix convention — `VISUAL` wins for full-screen
 * editors), falling back to `notepad` on Windows and `vi` elsewhere. The env
 * value may include flags (e.g. `code --wait`, `emacs -nw`), so it's split on
 * whitespace into a command + args. Pure + unit-tested.
 */
export function resolveEditor(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const raw = (env.VISUAL || env.EDITOR || '').trim();
  if (raw) return raw.split(/\s+/);
  return platform === 'win32' ? ['notepad'] : ['vi'];
}

export interface EditorResult {
  ok: boolean;
  /** Editor argv[0] that was launched. */
  editor: string;
  /** Process exit code, when the editor ran and exited normally. */
  code?: number;
  /** Populated when the editor couldn't be launched at all. */
  error?: string;
}

/**
 * Open `file` in the resolved editor, inheriting the terminal so the editor is
 * interactive. Returns a structured result rather than throwing so the caller
 * controls messaging/exit. `spawn` is injected for tests.
 */
export function openInEditor(
  file: string,
  deps: { spawn?: typeof spawnSync; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): EditorResult {
  const spawn = deps.spawn ?? spawnSync;
  const [cmd, ...args] = resolveEditor(deps.env, deps.platform);
  const res = spawn(cmd, [...args, file], { stdio: 'inherit' });
  if (res.error) {
    const err = res.error as NodeJS.ErrnoException;
    const reason = err.code === 'ENOENT' ? `editor "${cmd}" not found` : err.message;
    return { ok: false, editor: cmd, error: reason };
  }
  const code = typeof res.status === 'number' ? res.status : 1;
  return { ok: code === 0, editor: cmd, code };
}
