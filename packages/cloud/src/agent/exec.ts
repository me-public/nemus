import { spawn } from 'node:child_process';

export interface ExecResultRaw {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command (no shell), optionally in `cwd`, optionally streaming combined
 *  output to the parent's stdout/stderr live (for log-through). Injectable. */
export type Exec = (
  bin: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; stream?: boolean },
) => Promise<ExecResultRaw>;

export const shellExec: Exec = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      if (opts.stream) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (opts.stream) process.stderr.write(d);
    });
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: `${stderr}${e}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

/** Run and throw a helpful error on a non-zero exit. */
export async function run(
  exec: Exec,
  bin: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; stream?: boolean },
): Promise<ExecResultRaw> {
  const r = await exec(bin, args, opts);
  if (r.code !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r;
}
