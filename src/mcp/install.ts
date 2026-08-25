#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logSuccess, logError, logInfo, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { installPermissionSyncHook, uninstallPermissionSyncHook, syncAllWorkspacePermissions, installWorkspaceSkills, uninstallWorkspaceSkills, installWorkspaceStatusLine, uninstallWorkspaceStatusLine } from '../utils/permission-sync';
import { WORKSPACES_DIR, getUserConfig } from '../utils/config';
import { generateMcpConfig, backfillAgentRules } from '../utils/claude-integration';
import { listWorkspaces } from '../utils/workspace-meta';
import { getActiveAgents, isAgentCliAvailable, getMcpAgents } from '../utils/agent-config';
import { installPiExtensions, uninstallPiExtensions, getPiExtensionStatus } from '../utils/pi-extensions';
import { checkForUpdate } from '../utils/version-check';

/**
 * Install shell integration (w/workspace shell functions for auto-CD).
 * Non-interactive and idempotent — safe to call from postinstall or mcp install.
 */
function installShellIntegration(): void {
  const shell = process.env.SHELL || '';
  let shellType: string;

  if (shell.endsWith('/zsh')) {
    shellType = 'zsh';
  } else if (shell.endsWith('/bash')) {
    shellType = 'bash';
  } else {
    logInfo('Unknown shell — skipping shell integration (auto-CD)');
    return;
  }

  const scriptPath = path.join(__dirname, '..', '..', 'install-shell-integration.sh');
  if (!fs.existsSync(scriptPath)) {
    logInfo('Shell integration script not found — skipping');
    return;
  }

  try {
    execSync(`bash "${scriptPath}" ${shellType}`, { stdio: 'inherit' });
    logSuccess('Shell integration installed (auto-CD for w/workspace commands)');
  } catch {
    logInfo('Shell integration install skipped (non-critical)');
  }

  // Print a prominent reminder — without sourcing, the shell function is
  // not active in the current session and 'w' resolves to the system binary.
  const rcFile = shellType === 'zsh' ? '~/.zshrc' : '~/.bashrc';
  console.log('');
  console.log('  \x1b[33m⚠️  IMPORTANT — activate the shell function in this session:\x1b[0m');
  console.log('');
  console.log(`     \x1b[36msource ${rcFile}\x1b[0m`);
  console.log('');
  console.log('  Or open a new terminal tab. Until then, \x1b[36mw\x1b[0m resolves to the');
  console.log('  Unix \x1b[90mw\x1b[0m command (shows logged-in users), not workspace manager.');
  console.log('');
  console.log('  Tip: \x1b[36mworkspace\x1b[0m works immediately without sourcing:');
  console.log('       \x1b[36mworkspace configure\x1b[0m   \x1b[90m# first-time setup\x1b[0m');
  console.log('       \x1b[36mworkspace list\x1b[0m        \x1b[90m# list workspaces\x1b[0m');
  console.log('');
}

function getMcpServerPath(): string {
  // When compiled, __dirname is dist/mcp/ — server.js is a sibling
  const distPath = path.join(__dirname, 'server.js');
  // When running from ts-node, __dirname is src/mcp/ — compiled output is at dist/mcp/server.js
  const srcPath = path.join(__dirname, '..', '..', 'dist', 'mcp', 'server.js');

  if (fs.existsSync(distPath)) {
    return distPath;
  }
  if (fs.existsSync(srcPath)) {
    return srcPath;
  }

  throw new Error(
    'Could not find mcp-server.js. Make sure to run `npm run build` first.'
  );
}

/**
 * Install/update hooks and skills (idempotent).
 * Shared by both `install` and `upgrade` commands.
 */
function installHooksAndSkills() {
  const agents = getActiveAgents();
  const claudeActive = agents.some(a => a.type === 'claude');
  const piActive = agents.some(a => a.type === 'pi');
  const config = getUserConfig();

  // Claude-specific hooks (only install if Claude is active)
  if (claudeActive) {
    // Install permission sync hook
    try {
      installPermissionSyncHook();
    } catch (error) {
      logError('Failed to install permission sync hook');
      if (error instanceof Error) {
        logError(error.message);
      }
    }

    // Install workspace repo-table status line (only if enabled in config)
    if (config.claudeWorkspaceStatusLine !== false) {
      try {
        installWorkspaceStatusLine();
      } catch (error) {
        logError('Failed to install workspace status-line');
        if (error instanceof Error) logError(error.message);
      }
    } else {
      // Opt-out: remove any previously installed status line
      try { uninstallWorkspaceStatusLine(); } catch { /* ignore */ }
    }
  }

  // Install nemus skills (MCP + CLI command skills) — always for all active agents
  try {
    installWorkspaceSkills();
  } catch (error) {
    logError('Failed to install nemus skills');
    if (error instanceof Error) {
      logError(error.message);
    }
  }

  // Install Pi extensions (if Pi is an active agent)
  if (piActive) {
    try {
      installPiExtensions(undefined, { workspaceInputStatus: config.piWorkspaceInputStatus !== false });
    } catch (error) {
      logError('Failed to install Pi extensions');
      if (error instanceof Error) {
        logError(error.message);
      }
    }
    // If input-status widget is disabled, remove any previously installed copy
    if (config.piWorkspaceInputStatus === false) {
      try { uninstallPiExtensions(undefined, { onlyNames: ['ws-workspace-input-status.ts'] }); } catch { /* ignore */ }
    }
  }
}

/**
 * Backfill .mcp.json for all existing workspaces that don't have the
 * nemus entry yet.
 */
async function backfillMcpJson() {
  const { installMcp } = getUserConfig();
  if (!installMcp) return;

  try {
    const workspaces = await listWorkspaces(false);
    if (workspaces.length === 0) return;

    logInfo(`Backfilling .mcp.json for ${workspaces.length} existing workspace(s)...`);
    let updated = 0;

    for (const ws of workspaces) {
      const success = await generateMcpConfig(ws.path);
      if (success) updated++;
    }

    if (updated > 0) {
      logSuccess(`Updated .mcp.json in ${updated} workspace(s)`);
    }
  } catch (error) {
    logWarning('Could not backfill .mcp.json for existing workspaces');
  }
}

/**
 * Backfill AGENTS.md (Pi context file) for existing workspaces that only
 * have .claude.md. Runs during install/upgrade when Pi is an active agent.
 * Also patches in the "AI Agent Rules" section for any context file that
 * pre-dates it (idempotent).
 */
async function backfillAgentsContext() {
  const agents = getActiveAgents();
  const piActive = agents.some(a => a.type === 'pi');
  const claudeActive = agents.some(a => a.type === 'claude');

  try {
    const workspaces = await listWorkspaces(false);
    if (workspaces.length === 0) return;

    let converted = 0;
    let claudeRenamed = 0;
    let rulesPatched = 0;

    for (const ws of workspaces) {
      const agentsMdPath = path.join(ws.path, 'AGENTS.md');
      const claudeMdPath = path.join(ws.path, '.claude.md');
      const claudeMdUpper = path.join(ws.path, 'CLAUDE.md');

      // Convert .claude.md → AGENTS.md for Pi users (original backfill behaviour)
      if (piActive && fs.existsSync(claudeMdPath) && !fs.existsSync(agentsMdPath)) {
        try {
          const content = fs.readFileSync(claudeMdPath, 'utf-8');
          const fixed = content.replace(/\.claude\.md/g, 'AGENTS.md');
          fs.writeFileSync(agentsMdPath, fixed, 'utf-8');
          converted++;
        } catch { /* skip on error */ }
      }

      // Migrate the dead hidden .claude.md → CLAUDE.md for Claude users (issue
      // #186): Claude Code never auto-loaded '.claude.md', so the workspace
      // context never surfaced. Create the correctly-named CLAUDE.md (unless
      // one already exists — don't clobber a real one) and remove the dead file.
      // The pi conversion above already ran, so AGENTS.md is preserved.
      if (claudeActive && fs.existsSync(claudeMdPath) && !fs.existsSync(claudeMdUpper)) {
        try {
          const content = fs.readFileSync(claudeMdPath, 'utf-8');
          const fixed = content.replace(/\.claude\.md/g, 'CLAUDE.md');
          fs.writeFileSync(claudeMdUpper, fixed, 'utf-8');
          fs.rmSync(claudeMdPath, { force: true });
          claudeRenamed++;
        } catch { /* skip on error */ }
      }

      // Patch the AI Agent Rules section into any existing context file that
      // was created before this section was introduced (idempotent).
      try {
        const wsName = ws.name;
        const n = await backfillAgentRules(ws.path, wsName);
        rulesPatched += n;
      } catch { /* non-critical */ }
    }

    if (converted > 0) {
      logSuccess(`Backfilled AGENTS.md in ${converted} workspace(s) for Pi compatibility`);
    }
    if (claudeRenamed > 0) {
      logSuccess(`Migrated .claude.md → CLAUDE.md in ${claudeRenamed} workspace(s) so Claude Code auto-loads it`);
    }
    if (rulesPatched > 0) {
      logSuccess(`Added AI Agent Rules section to ${rulesPatched} workspace context file(s)`);
    }
  } catch (error) {
    logWarning('Could not backfill AGENTS.md for existing workspaces');
  }
}

async function install() {
  const agents = getActiveAgents();
  const mcpAgents = getMcpAgents();

  // Check that at least one configured agent CLI is available
  const availableAgents = agents.filter(a => isAgentCliAvailable(a.type));
  if (availableAgents.length === 0) {
    logError('No configured AI agent CLI found. Install at least one:');
    for (const a of agents) {
      if (a.type === 'claude') console.log('  npm install -g @anthropic-ai/claude-code');
      if (a.type === 'pi') console.log('  npm install -g @earendil-works/pi-coding-agent');
      if (a.type === 'opencode') console.log('  npm install -g opencode-ai');
    }
    process.exit(1);
  }

  // Register MCP server with Claude Code (only agent that supports MCP CLI registration)
  const claudeAgent = mcpAgents.find(a => a.type === 'claude');
  if (claudeAgent && isAgentCliAvailable('claude')) {
    const serverPath = getMcpServerPath();
    logInfo(`MCP server path: ${colorize(serverPath, 'cyan')}`);

    try {
      execSync(
        `claude mcp add nemus -s user -- node "${serverPath}"`,
        { stdio: 'pipe' }
      );
      logSuccess('MCP server registered globally with Claude Code');
      console.log('\nYou can now use nemus tools in any Claude Code session.');
      console.log('Try asking: "list my workspaces" or "what\'s the status of my-workspace"');
    } catch (error) {
      const stderr = error instanceof Error && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : '';
      if (stderr.includes('already exists') || (error instanceof Error && error.message.includes('already exists'))) {
        logInfo('MCP server already registered with Claude Code — skipping');
      } else {
        logError('Failed to register MCP server with Claude Code');
        if (error instanceof Error) {
          logError(error.message);
        }
      }
    }
  } else if (mcpAgents.length > 0) {
    logInfo('Claude Code CLI not found — skipping MCP registration');
  }

  // Log Pi-specific info
  const piAgent = agents.find(a => a.type === 'pi');
  if (piAgent) {
    logInfo('Pi uses extensions instead of MCP — skills will be installed to ' + piAgent.skillsDir);
  }

  // Log OpenCode-specific info
  const opencodeAgent = agents.find(a => a.type === 'opencode');
  if (opencodeAgent) {
    logInfo('OpenCode supports MCP natively — configure in .opencode/opencode.jsonc');
    logInfo('Skills will be installed to ' + opencodeAgent.skillsDir);
  }

  installHooksAndSkills();
  installShellIntegration();
  await backfillMcpJson();
  await backfillAgentsContext();
}

async function upgrade() {
  // Warn immediately if a newer package version is available.
  // This is the most common reason extensions are missing after
  // running upgrade — the user upgraded npm but didn't re-install.
  const updateMsg = await checkForUpdate();
  if (updateMsg) {
    console.log('');
    console.log(updateMsg);
    console.log('\x1b[33m  ⚠️  Run npm install first, then re-run w mcp upgrade to get new features.\x1b[0m');
    console.log('');
  }

  const agents = getActiveAgents();
  const availableAgents = agents.filter(a => isAgentCliAvailable(a.type));

  if (availableAgents.length === 0) {
    logError('No configured AI agent CLI found. Install at least one:');
    for (const a of agents) {
      if (a.type === 'claude') console.log('  npm install -g @anthropic-ai/claude-code');
      if (a.type === 'pi') console.log('  npm install -g @earendil-works/pi-coding-agent');
      if (a.type === 'opencode') console.log('  npm install -g opencode-ai');
    }
    process.exit(1);
  }

  logInfo(`Upgrading hooks and skills for: ${availableAgents.map(a => a.type).join(', ')}...`);
  installHooksAndSkills();
  installShellIntegration();
  await backfillMcpJson();
  await backfillAgentsContext();
  logSuccess('Upgrade complete');
}

function uninstall() {
  // Remove nemus skills (from all agent directories)
  try {
    uninstallWorkspaceSkills();
    logSuccess('Workspace-manager skills removed from all agents');
  } catch (error) {
    logError('Failed to remove nemus skills');
    if (error instanceof Error) {
      logError(error.message);
    }
  }

  // Remove Pi extensions
  try {
    uninstallPiExtensions();
    logSuccess('Pi extensions removed');
  } catch (error) {
    logError('Failed to remove Pi extensions');
    if (error instanceof Error) {
      logError(error.message);
    }
  }

  // Remove workspace status-line (Claude Code statusLine + script)
  try {
    uninstallWorkspaceStatusLine();
  } catch (error) {
    logError('Failed to remove workspace status-line');
    if (error instanceof Error) logError(error.message);
  }

  // Remove permission sync hook
  try {
    uninstallPermissionSyncHook();
  } catch (error) {
    logError('Failed to remove permission sync hook');
    if (error instanceof Error) {
      logError(error.message);
    }
  }

  // Unregister MCP from Claude (if available)
  if (isAgentCliAvailable('claude')) {
    try {
      execSync('claude mcp remove nemus -s user', { stdio: 'inherit' });
      logSuccess('MCP server unregistered from Claude Code');
    } catch (error) {
      logError('Failed to unregister MCP server');
      if (error instanceof Error) {
        logError(error.message);
      }
    }
  } else {
    logInfo('Claude Code CLI not found — skipping MCP unregistration');
  }
}

function status() {
  const agents = getActiveAgents();
  let anyFound = false;

  for (const agent of agents) {
    console.log(`\n${colorize(agent.type.toUpperCase(), 'bright')}:`);

    if (!isAgentCliAvailable(agent.type)) {
      logInfo(`  ${agent.type} CLI not found`);
      continue;
    }

    anyFound = true;

    // Check skills installation
    const skillsExist = fs.existsSync(agent.skillsDir);
    if (skillsExist) {
      const skillCount = fs.readdirSync(agent.skillsDir).filter(d => {
        const skillPath = path.join(agent.skillsDir, d, 'SKILL.md');
        return fs.existsSync(skillPath);
      }).length;
      logSuccess(`  ${skillCount} skills installed in ${agent.skillsDir}`);
    } else {
      logInfo(`  No skills directory at ${agent.skillsDir}`);
    }

    // Check MCP (Claude only)
    if (agent.supportsMcp) {
      try {
        const output = execSync('claude mcp list', { encoding: 'utf-8' });
        const isRegistered = output.includes('nemus');
        if (isRegistered) {
          logSuccess('  MCP server registered');
          const lines = output.split('\n').filter(l => l.includes('nemus'));
          if (lines.length > 0) {
            console.log(`    ${lines[0].trim()}`);
          }
        } else {
          logInfo('  MCP server not registered');
          console.log('    Run: w mcp install');
        }
      } catch (error) {
        logError('  Failed to check MCP status');
      }
    } else {
      logInfo(`  ${agent.type} uses extensions instead of MCP`);
      // Show Pi extension status
      const extStatus = getPiExtensionStatus();
      if (extStatus.installed.length > 0) {
        logSuccess(`  ${extStatus.installed.length} managed extension(s) installed`);
        for (const ext of extStatus.installed) {
          console.log(`    ✓ ${ext}`);
        }
      }
      if (extStatus.missing.length > 0) {
        logWarning(`  ${extStatus.missing.length} managed extension(s) missing`);
        for (const ext of extStatus.missing) {
          console.log(`    ✗ ${ext}`);
        }
        console.log('    Run: w mcp install');
      }
    }
  }

  if (!anyFound) {
    logError('No configured AI agent CLI found');
    process.exit(1);
  }
}

function syncPermissions() {
  logInfo('Scanning workspaces for permissions to sync...');
  syncAllWorkspacePermissions(WORKSPACES_DIR);
}

function updateSkills() {
  logInfo('Updating nemus skills...');
  try {
    installWorkspaceSkills();
  } catch (error) {
    logError('Failed to update skills');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

export async function main(subCommandArg?: string) {
  const subCommand = subCommandArg ?? process.argv[2];

  switch (subCommand) {
    case 'install':
      await install();
      break;
    case 'uninstall':
      uninstall();
      break;
    case 'upgrade':
      await upgrade();
      break;
    case 'status':
      status();
      break;
    case 'sync-permissions':
      syncPermissions();
      break;
    case 'update-skills':
      updateSkills();
      break;
    default:
      console.log(`
MCP Integration

Usage:
  w mcp install             Register nemus MCP server with Claude Code
  w mcp uninstall           Unregister the MCP server
  w mcp upgrade             Update hooks and skills without re-registering the MCP server
  w mcp update-skills       Update only the Claude Code skills (faster than full upgrade)
  w mcp status              Check if the MCP server is registered
  w mcp sync-permissions    Merge all workspace permissions into global settings
`);
      break;
  }
}

// Auto-execute only when run directly (not when imported by Commander)
if (require.main === module) {
  main().catch(err => { logError(err.message); process.exit(1); });
}
