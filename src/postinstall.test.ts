import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'scripts', 'postinstall.js');
// postinstall.js guards its side effects with `require.main !== module`, so
// importing it just exposes the pure classifier.
const { classifyInstall } = createRequire(__filename)(SCRIPT) as {
  classifyInstall: (i: { env: Record<string, string | undefined>; dirname: string; tmpDir: string }) => string;
};

const NPM_UA = 'npm/10.9.0 node/v22.13.0 darwin arm64 workspaces/false';
const YARN_UA = 'yarn/1.22.22 npm/? node/v22.13.0 darwin arm64';
const PNPM_UA = 'pnpm/10.34.5 npm/? node/v22.13.0';
const TMP = '/var/folders/xy/T';

describe('classifyInstall', () => {
  it('CI → ci', () => {
    expect(classifyInstall({ env: { CI: 'true' }, dirname: '/anywhere', tmpDir: TMP })).toBe('ci');
  });

  it('npm -g → global-npm; npm local → local', () => {
    expect(classifyInstall({ env: { npm_config_global: 'true', npm_config_user_agent: NPM_UA }, dirname: '/usr/local/lib/node_modules/@nemus-cli/nemus/scripts', tmpDir: TMP })).toBe('global-npm');
    expect(classifyInstall({ env: { npm_config_global: 'false', npm_config_user_agent: NPM_UA }, dirname: '/proj/node_modules/@nemus-cli/nemus/scripts', tmpDir: TMP })).toBe('local');
  });

  it('npx (npm_command=exec) → transient', () => {
    expect(classifyInstall({ env: { npm_command: 'exec', npm_config_user_agent: NPM_UA }, dirname: '/home/u/.npm/_npx/abc123/node_modules/@nemus-cli/nemus/scripts', tmpDir: TMP })).toBe('transient');
  });

  it('yarn global add (bare yarn UA, no npm_command/global) → global-other', () => {
    expect(classifyInstall({ env: { npm_config_user_agent: YARN_UA }, dirname: '/home/u/.config/yarn/global/node_modules/@nemus-cli/nemus/scripts', tmpDir: TMP })).toBe('global-other');
  });

  it('pnpm add -g (bare pnpm UA) → global-other', () => {
    expect(classifyInstall({ env: { npm_config_user_agent: PNPM_UA }, dirname: '/home/u/Library/pnpm/global/5/node_modules/@nemus-cli/nemus/scripts', tmpDir: TMP })).toBe('global-other');
  });

  // The reviewer's case: `pnpm dlx` sets NEITHER npm_command NOR
  // npm_config_global — only the pnpm user-agent. UA-only logic would call this
  // "global-other" and re-introduce the /dev/tty hang. The install PATH
  // (".../pnpm/dlx/<hash>/...") is the signal that saves us.
  it('pnpm dlx (only pnpm UA, staged under .../pnpm/dlx/...) → transient', () => {
    const dir = '/home/u/Library/Caches/pnpm/dlx/ed050d93/1a07/node_modules/@nemus-cli/nemus/scripts';
    expect(classifyInstall({ env: { npm_config_user_agent: PNPM_UA }, dirname: dir, tmpDir: TMP })).toBe('transient');
  });

  it('yarn berry dlx (only yarn UA, staged under the OS temp dir) → transient', () => {
    const dir = `${TMP}/xfs-9f/node_modules/@nemus-cli/nemus/scripts`;
    expect(classifyInstall({ env: { npm_config_user_agent: YARN_UA }, dirname: dir, tmpDir: TMP })).toBe('transient');
  });

  // The real macOS case: os.tmpdir() reports /var/folders/… (a symlink) while a
  // package staged under it resolves to /private/var/folders/… . A raw
  // startsWith would miss this and misclassify the dlx run as global-other
  // (spurious shell-RC write). The classifier must normalize the /private prefix.
  it('yarn/pnpm dlx staged under /private/var while tmpDir is /var → transient', () => {
    const tmpDir = '/var/folders/xy/T';
    const dir = '/private/var/folders/xy/T/xfs-9f/node_modules/@nemus-cli/nemus/scripts';
    expect(classifyInstall({ env: { npm_config_user_agent: YARN_UA }, dirname: dir, tmpDir })).toBe('transient');
    // symmetric: tmpDir realpath'd to /private while dir stays /var
    expect(classifyInstall({ env: { npm_config_user_agent: PNPM_UA }, dirname: '/var/folders/xy/T/d/node_modules/x', tmpDir: '/private/var/folders/xy/T' })).toBe('transient');
  });
});

/** Run the real postinstall.js in a sandbox HOME with a controlled environment.
 *  stdio is ignored and there's no tty, and NEMUS_SKIP_CONFIGURE guards a
 *  tty-bearing host, so we exercise the gate + non-interactive shell-integration
 *  path end-to-end (dirname is the real repo path — never transient). */
function runPostinstall(rcName: string, extraEnv: Record<string, string | undefined>) {
  const home = mkdtempSync(join(tmpdir(), 'nemus-postinstall-'));
  const rc = join(home, rcName);
  writeFileSync(rc, '# user rc\n');
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    NEMUS_CACHE_DIR: join(home, '.nemus'),
    NEMUS_SKIP_CONFIGURE: '1',
  };
  delete env.CI;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  execFileSync(process.execPath, [SCRIPT], { env, stdio: 'ignore', timeout: 20_000 });
  const rcAfter = readFileSync(rc, 'utf8');
  rmSync(home, { recursive: true, force: true });
  return rcAfter;
}

describe('postinstall.js (end-to-end)', () => {
  it('npx / npm exec → no-op, RC untouched', () => {
    expect(runPostinstall('.zshrc', { npm_command: 'exec', npm_config_user_agent: NPM_UA, npm_config_global: undefined, SHELL: '/bin/zsh' })).toBe('# user rc\n');
  });

  it('npm local dependency install (global="false") → no-op, RC untouched', () => {
    expect(runPostinstall('.zshrc', { npm_command: 'install', npm_config_user_agent: NPM_UA, npm_config_global: 'false', SHELL: '/bin/zsh' })).toBe('# user rc\n');
  });

  it('npm global install → runs shell integration (RC gets the source line)', () => {
    expect(runPostinstall('.zshrc', { npm_command: 'install', npm_config_user_agent: NPM_UA, npm_config_global: 'true', SHELL: '/bin/zsh' })).toContain('.nemus/shell-integration.sh');
  });

  it('yarn global add (no npm_config_global) → runs shell integration', () => {
    expect(runPostinstall('.bashrc', { npm_command: undefined, npm_config_user_agent: YARN_UA, npm_config_global: undefined, SHELL: '/bin/bash' })).toContain('.nemus/shell-integration.sh');
  });

  it('pnpm add -g (no npm_config_global) → runs shell integration', () => {
    expect(runPostinstall('.bashrc', { npm_command: undefined, npm_config_user_agent: PNPM_UA, npm_config_global: undefined, SHELL: '/bin/bash' })).toContain('.nemus/shell-integration.sh');
  });
});
