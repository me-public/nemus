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
const path = require('path');

// Skip in CI environments
if (process.env.CI) process.exit(0);

const PKG_ROOT = path.join(__dirname, '..');
const SHELL_SCRIPT = path.join(PKG_ROOT, 'install-shell-integration.sh');

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
