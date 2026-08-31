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

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Skip in CI environments
if (process.env.CI) process.exit(0);

const PKG_ROOT = path.join(__dirname, '..');
const SHELL_SCRIPT = path.join(PKG_ROOT, 'install-shell-integration.sh');
const CLI_BIN = path.join(PKG_ROOT, 'bin', 'workspace.js');

// ── First-time interactive setup ─────────────────────────────────────────────
// On a FRESH install with an interactive terminal, run `nemus configure` right
// away so setup happens after install instead of the user having to remember to.
// `configure` is a superset of this script's work — it installs the shell
// integration + (optionally) the MCP server and prints the source reminder — so
// on success we exit here. We fall through to the non-interactive path when:
// there's already a config (an upgrade, not a first install), stdin/stdout
// aren't TTYs (piped/scripted installs — inquirer would hang or EOF), the user
// opted out (NEMUS_SKIP_CONFIGURE), or the CLI/build isn't present. That keeps
// the worst case identical to today's behavior: a printed tip, never a hang.
function cacheDir() {
  return (
    process.env.NEMUS_CACHE_DIR ||
    process.env.WORKSPACE_MANAGER_CACHE_DIR ||
    path.join(os.homedir(), '.nemus')
  );
}

function shouldRunConfigure() {
  if (process.env.NEMUS_SKIP_CONFIGURE) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if (!fs.existsSync(CLI_BIN)) return false;
  // Fresh install only — don't re-prompt on every `npm i -g` upgrade.
  if (fs.existsSync(path.join(cacheDir(), 'config.json'))) return false;
  return true;
}

if (shouldRunConfigure()) {
  try {
    execSync(`node "${CLI_BIN}" configure`, { stdio: 'inherit' });
    process.exit(0); // configure handled shell integration + reminder
  } catch {
    // Canceled / non-interactive after all — fall through to the standard setup
    // + tip below so the install still leaves things in a working state.
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
console.log('  Tip: \x1b[36mnemus\x1b[0m works immediately (\x1b[36mgv\x1b[0m is a short alias):');
console.log('       \x1b[36mnemus configure\x1b[0m   \x1b[90m# first-time setup\x1b[0m');
console.log('       \x1b[36mnemus list\x1b[0m        \x1b[90m# list workspaces\x1b[0m');
console.log('');
