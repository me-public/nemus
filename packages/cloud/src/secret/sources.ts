import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SecretSource } from './types';

/** `env:NAME` — read from a process environment map (default `process.env`). */
export class EnvSecretSource implements SecretSource {
  readonly id = 'env';
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async resolve(name: string): Promise<string> {
    const v = this.env[name];
    if (v == null || v === '') throw new Error(`env secret "${name}" is not set`);
    return v;
  }
}

/**
 * `dotenv:NAME` — read from a `.env`-style file. The file is read once and
 * parsed lazily; `content` can be injected for tests.
 */
export class DotenvSecretSource implements SecretSource {
  readonly id = 'dotenv';
  private parsed?: Record<string, string>;
  constructor(
    private readonly path = '.env',
    private readonly content?: string,
  ) {}
  private load(): Record<string, string> {
    if (this.parsed) return this.parsed;
    const text = this.content ?? readFileSync(this.path, 'utf-8');
    this.parsed = parseDotenv(text);
    return this.parsed;
  }
  async resolve(name: string): Promise<string> {
    const v = this.load()[name];
    if (v == null) throw new Error(`dotenv secret "${name}" not found in ${this.path}`);
    return v;
  }
}

/** `gh:HOST` — the GitHub CLI's token (`gh auth token`). Locator is the host
 *  (default github.com). `exec` is injectable for tests. */
export class GhCliSecretSource implements SecretSource {
  readonly id = 'gh';
  constructor(
    private readonly exec: (
      bin: string,
      args: string[],
    ) => Promise<string> = defaultExec,
  ) {}
  async resolve(host = 'github.com'): Promise<string> {
    const args = ['auth', 'token'];
    if (host && host !== 'github.com') args.push('--hostname', host);
    const out = (await this.exec('gh', args)).trim();
    if (!out) throw new Error('gh auth token returned empty — run `gh auth login`');
    return out;
  }
}

/** Minimal `.env` parser: `KEY=VALUE`, `#` comments, optional quotes, `export`. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const defaultExec = (bin: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf-8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
