import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'scripts', 'postinstall.js');
const NPM_UA = 'npm/10.9.0 node/v22.13.0 darwin arm64 workspaces/false';
const YARN_UA = 'yarn/1.22.22 npm/? node/v22.13.0 darwin arm64';
const PNPM_UA = 'pnpm/9.12.0 npm/? node/v22.13.0';

/** Run postinstall.js in a sandbox HOME with a controlled install environment.
 *  stdio is ignored and there's no controlling tty, so the interactive
 *  `configure` step can't fire — we exercise the gate + shell-integration path. */
function runPostinstall(rcName: string, extraEnv: Record<string, string | undefined>) {
  const home = mkdtempSync(join(tmpdir(), 'nemus-postinstall-'));
  const rc = join(home, rcName);
  writeFileSync(rc, '# user rc\n');
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    NEMUS_CACHE_DIR: join(home, '.nemus'),
    // Belt: opt out of the interactive step so a test host WITH a tty can't hang.
    NEMUS_SKIP_CONFIGURE: '1',
  };
  delete env.CI; // ensure the gate under test — not the CI early-exit — decides
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  execFileSync(process.execPath, [SCRIPT], { env, stdio: 'ignore', timeout: 20_000 });
  const rcAfter = readFileSync(rc, 'utf8');
  rmSync(home, { recursive: true, force: true });
  return rcAfter;
}

describe('postinstall.js install-context gate', () => {
  // Regression: a transient `npx @nemus-cli/nemus …` (npm exec) must not launch
  // the interactive `configure` (which reaches /dev/tty and hung `npx … --help`)
  // nor mutate the shell RC. npm sets npm_command="exec" for npx.
  it('npx / npm exec → no-op, RC untouched', () => {
    const rc = runPostinstall('.zshrc', { npm_command: 'exec', npm_config_user_agent: NPM_UA, npm_config_global: undefined, SHELL: '/bin/zsh' });
    expect(rc).toBe('# user rc\n');
  });

  it('npm local dependency install (global="false") → no-op, RC untouched', () => {
    const rc = runPostinstall('.zshrc', { npm_command: 'install', npm_config_user_agent: NPM_UA, npm_config_global: 'false', SHELL: '/bin/zsh' });
    expect(rc).toBe('# user rc\n');
  });

  it('npm global install (global="true") → runs shell integration (RC gets the source line)', () => {
    const rc = runPostinstall('.zshrc', { npm_command: 'install', npm_config_user_agent: NPM_UA, npm_config_global: 'true', SHELL: '/bin/zsh' });
    expect(rc).toContain('.nemus/shell-integration.sh');
  });

  // The review point: yarn/pnpm don't set npm_config_global, so a global install
  // via them must still be recognised (advertised in npm_config_user_agent) and
  // get shell integration — not silently skipped.
  it('yarn global add (no npm_config_global) → runs shell integration', () => {
    const rc = runPostinstall('.bashrc', { npm_command: undefined, npm_config_user_agent: YARN_UA, npm_config_global: undefined, SHELL: '/bin/bash' });
    expect(rc).toContain('.nemus/shell-integration.sh');
  });

  it('pnpm add -g (no npm_config_global) → runs shell integration', () => {
    const rc = runPostinstall('.bashrc', { npm_command: undefined, npm_config_user_agent: PNPM_UA, npm_config_global: undefined, SHELL: '/bin/bash' });
    expect(rc).toContain('.nemus/shell-integration.sh');
  });

  it('yarn/pnpm dlx (transient) → no-op, RC untouched', () => {
    const rc = runPostinstall('.bashrc', { npm_command: 'dlx', npm_config_user_agent: PNPM_UA, npm_config_global: undefined, SHELL: '/bin/bash' });
    expect(rc).toBe('# user rc\n');
  });
});
