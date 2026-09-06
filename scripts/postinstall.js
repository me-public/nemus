#!/usr/bin/env node
/**
 * postinstall.js — runs after `npm install -g @nemus-cli/nemus`
 *
 * Installs the shell integration (nemus/nem shell functions) so that the
 * shell can auto-CD into a workspace after create / list / go commands.
 *
 * Using a dedicated script (not `node -e`) gives us reliable __dirname
 * access so the path to install-shell-integration.sh is always correct
 * regardless of the npm install working directory.
 */

'use strict';

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Classify the install context, so first-run setup (interactive `configure` +
 * shell integration) runs only when it makes sense — and NEVER on a transient
 * one-off runner (npx / dlx), where an interactive prompt on the controlling
 * terminal would HANG. Pure (all inputs injected) so it's unit-tested.
 *
 * Returns: 'ci' | 'transient' | 'local' | 'global-npm' | 'global-other'.
 *
 * Detection is empirical (env dumped from real runners), because the managers
 * disagree on what they set:
 *   • npm  — npx sets npm_command="exec"; `-g` sets npm_config_global="true"; a
 *            local install sets it "false". Reliable.
 *   • pnpm — `pnpm dlx` sets NEITHER npm_command NOR npm_config_global, only
 *            npm_config_user_agent="pnpm/…". It DOES stage the package under a
 *            per-run cache path ("…/pnpm/dlx/<hash>/…"), which we key on.
 *   • yarn — classic `yarn global add` sets only "yarn/…" (no npm_command /
 *            npm_config_global); berry `yarn dlx` stages under a temp dir.
 * So a bare yarn/pnpm user-agent is treated as a GLOBAL install UNLESS the
 * install PATH shows a transient runner cache. Inferring "global" from the
 * user-agent alone would misclassify `pnpm dlx`/`yarn dlx` and re-introduce the
 * /dev/tty hang for the dlx analog of npx — the path signal is what makes the
 * transient skip robust when npm_command is absent.
 */
function classifyInstall({ env, dirname, tmpDir }) {
  if (env.CI) return 'ci';

  const cmd = (env.npm_command || '').toLowerCase();
  const dir = String(dirname || '').replace(/\\/g, '/');
  const tmp = String(tmpDir || '').replace(/\\/g, '/');
  const stagedInRunnerCache =
    /\/_npx\//.test(dir) ||                              // npm  npx
    /\/dlx\//.test(dir) ||                               // pnpm dlx (or any /dlx/ cache)
    (tmp !== '' && (dir === tmp || dir.startsWith(tmp + '/'))); // yarn berry dlx et al.
  if (cmd === 'exec' || cmd === 'dlx' || stagedInRunnerCache) return 'transient';

  const global = String(env.npm_config_global).toLowerCase();
  if (global === 'true') return 'global-npm';
  if (global === 'false') return 'local';

  // No npm_config_global (yarn/pnpm): a bare manager user-agent means a global
  // install here (their transient runners were caught above).
  const manager = (env.npm_config_user_agent || '').toLowerCase().split('/')[0];
  if (manager === 'yarn' || manager === 'pnpm') return 'global-other';
  return 'local';
}

module.exports = { classifyInstall };

// When imported (unit tests) rather than run as the postinstall script, stop
// here — export the classifier without executing any install side effects.
// (CommonJS wraps modules in a function, so a top-level return is valid.)
if (require.main !== module) return;

const installDecision = classifyInstall({ env: process.env, dirname: __dirname, tmpDir: os.tmpdir() });
// Only 'global-*' installs get first-run setup; ci/transient/local are no-ops.
if (installDecision !== 'global-npm' && installDecision !== 'global-other') process.exit(0);
// Interactive `configure` (reaches /dev/tty) fires ONLY when we're certain it's
// an npm `-g` install. yarn/pnpm can't be told apart from their dlx runners by
// env alone, so they get the NON-interactive shell integration below + a hint —
// which can never hang.
const certainNpmGlobal = installDecision === 'global-npm';

const PKG_ROOT = path.join(__dirname, '..');
const SHELL_SCRIPT = path.join(PKG_ROOT, 'install-shell-integration.sh');
const CLI_BIN = path.join(PKG_ROOT, 'bin', 'workspace.js');

// ── First-time interactive setup ─────────────────────────────────────────────
// On a FRESH install, run `nemus configure` right away so setup happens after
// install instead of the user having to remember to. `configure` is a superset
// of this script's work — it installs the shell integration + (optionally) the
// MCP server and prints the source reminder — so on success we exit here.
//
// npm runs postinstall with stdio PIPED (not a TTY) unless `--foreground-scripts`
// is set, so we can't gate on process.std*.isTTY (it's falsy during a normal
// `npm i -g`, so the prompt would never fire). Instead we reach the controlling
// terminal directly via /dev/tty — openable during an interactive install even
// though npm piped our own stdio — and wire configure's stdio to it. With no
// controlling terminal (piped/scripted installs) the open fails and we fall
// through to the non-interactive tip path, so an install can never hang.
function cacheDir() {
  return (
    process.env.NEMUS_CACHE_DIR ||
    process.env.WORKSPACE_MANAGER_CACHE_DIR ||
    path.join(os.homedir(), '.nemus')
  );
}

// NEMUS_SKIP_CONFIGURE opts out — but only for real values: `0`/`false`/empty do
// NOT skip (a user setting `=0` means "don't skip").
function optedOut() {
  const v = (process.env.NEMUS_SKIP_CONFIGURE || '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

// The config marker `configure` writes (utils/config.ts: saveUserConfig ->
// <NEMUS_CACHE_DIR|WORKSPACE_MANAGER_CACHE_DIR|~/.nemus>/config.json). Same
// precedence as here, so its presence reliably means "already configured".
function alreadyConfigured() {
  return fs.existsSync(path.join(cacheDir(), 'config.json'));
}

// A read/write fd on the controlling terminal, or null if there isn't one.
function openControllingTty() {
  if (process.platform === 'win32') return null; // no /dev/tty; shell integration is bash/zsh anyway
  try {
    return fs.openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
}

if (certainNpmGlobal && !optedOut() && fs.existsSync(CLI_BIN) && !alreadyConfigured()) {
  const tty = openControllingTty();
  if (tty !== null) {
    try {
      // argv form (no shell) so an odd package path with quotes/$/backticks is
      // safe; stdio wired to the real terminal so inquirer can prompt.
      // process.execPath (not 'node') — node may not be on PATH during a
      // lifecycle script (nvm/Windows), and an ENOENT here would be swallowed by
      // the catch, silently skipping configure in the very case this targets.
      execFileSync(process.execPath, [CLI_BIN, 'configure'], { stdio: [tty, tty, tty] });
      fs.closeSync(tty);
      process.exit(0); // configure handled shell integration + reminder
    } catch {
      try { fs.closeSync(tty); } catch { /* ignore */ }
      // Canceled / failed — fall through to the standard setup + tip below so the
      // install still leaves things in a working state.
    }
  }
}

const shell = process.env.SHELL || '';
const shellType = shell.endsWith('/zsh') ? 'zsh'
  : shell.endsWith('/bash') ? 'bash'
  : null;

const rcFile = shellType === 'zsh' ? '~/.zshrc'
  : shellType === 'bash' ? '~/.bashrc'
  : null;

// ── Install shell integration ────────────────────────────────────────────────

if (!shellType) {
  console.log('\nNote: Unknown shell — skipping shell integration.');
  console.log('      Run  install-shell-integration.sh  manually for auto-CD support.\n');
  process.exit(0);
}

if (!fs.existsSync(SHELL_SCRIPT)) {
  console.log('\nNote: Shell integration script not found — skipping.\n');
  process.exit(0);
}

try {
  execSync(`bash "${SHELL_SCRIPT}" ${shellType}`, { stdio: 'inherit' });
} catch {
  console.log(`\nNote: Shell integration install failed.`);
  console.log(`      You can install it manually: bash "${SHELL_SCRIPT}" ${shellType}\n`);
  process.exit(0);
}

// ── Upgrade hooks, extensions and skills ───────────────────────────────────
// Idempotent: only acts when a previous `nemus mcp install` has been run.
// This ensures new features (Pi extensions, Claude Code status-line, etc.)
// reach existing users automatically on every `npm install -g` upgrade.

try {
  const mcpInstall = path.join(PKG_ROOT, 'dist', 'mcp', 'install.js');
  if (fs.existsSync(mcpInstall)) {
    execSync(`node "${mcpInstall}" upgrade`, { stdio: 'inherit' });
  }
} catch {
  // Non-critical — user can run `nemus mcp upgrade` manually
}

// ── Always print the source reminder ────────────────────────────────────────
// This is the single most important message for first-time users.
// Without sourcing the RC file the `nemus`/`nem` shell functions are not
// active, so auto-CD into a new workspace won't work in this terminal.

console.log('');
console.log('  \x1b[33m⚠️  IMPORTANT — activate the shell functions in this terminal:\x1b[0m');
console.log('');
console.log(`     \x1b[36msource ${rcFile}\x1b[0m`);
console.log('');
console.log('  Or open a new terminal tab. Until then, auto-CD into a new');
console.log('  workspace won\'t work (the CLI itself still runs fine).');
console.log('');
if (!certainNpmGlobal) {
  // yarn/pnpm global: we installed shell integration but deliberately did NOT
  // launch the interactive configure — point the user at it explicitly.
  console.log('  \x1b[90m(yarn/pnpm install — run \x1b[36mnemus configure\x1b[90m to finish first-time setup.)\x1b[0m');
  console.log('');
}
console.log('  Tip: \x1b[36mnemus\x1b[0m works immediately (\x1b[36mgv\x1b[0m is a short alias):');
console.log('       \x1b[36mnemus configure\x1b[0m   \x1b[90m# first-time setup\x1b[0m');
console.log('       \x1b[36mnemus list\x1b[0m        \x1b[90m# list workspaces\x1b[0m');
console.log('');
