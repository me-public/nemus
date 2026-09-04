import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'scripts', 'postinstall.js');

describe('postinstall.js', () => {
  // Regression: a transient `npx @nemus-cli/nemus …` (npm exec) or a local
  // dependency install is NOT global. Such installs must not launch the
  // interactive `configure` (which reaches /dev/tty and would HANG a
  // non-interactive `npx … --help`) nor mutate the user's shell RC — the bins
  // aren't persisted on PATH for them anyway.
  it('is a fast no-op for a non-global install: exits 0 and never touches the shell RC', () => {
    const home = mkdtempSync(join(tmpdir(), 'nemus-postinstall-'));
    const rc = join(home, '.zshrc');
    writeFileSync(rc, '# user rc\n');
    const env = { ...process.env, HOME: home, SHELL: '/bin/zsh', NEMUS_CACHE_DIR: join(home, '.nemus') };
    // Delete CI so the global gate — not the CI early-exit — is what protects npx.
    delete env.CI;
    delete env.npm_config_global; // npx / local install leaves this unset
    try {
      // Throws on non-zero exit; throws on the 15s timeout if it ever hangs.
      execFileSync(process.execPath, [SCRIPT], { env, stdio: 'ignore', timeout: 15_000 });
      // RC untouched — no guarded `source` line appended.
      expect(readFileSync(rc, 'utf8')).toBe('# user rc\n');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('treats npm_config_global="false" the same as unset (still a no-op)', () => {
    const home = mkdtempSync(join(tmpdir(), 'nemus-postinstall-'));
    const rc = join(home, '.bashrc');
    writeFileSync(rc, '# user rc\n');
    const env = {
      ...process.env,
      HOME: home,
      SHELL: '/bin/bash',
      NEMUS_CACHE_DIR: join(home, '.nemus'),
      npm_config_global: 'false',
    };
    delete env.CI;
    try {
      execFileSync(process.execPath, [SCRIPT], { env, stdio: 'ignore', timeout: 15_000 });
      expect(readFileSync(rc, 'utf8')).toBe('# user rc\n');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
