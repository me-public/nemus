import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { getUserConfig, saveUserConfig, UserConfig } from '../utils/config';
import { clearCache } from '../utils/cache';
import { logSuccess, logError, logInfo, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';

export function registerConfigureCommand(parent: Command) {
  parent
    .command('configure')
    .alias('cfg')
    .description('Configure workspace manager settings')
    .action(async () => {
      await handleConfigure();
    });
}

async function handleConfigure() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Workspace Manager Configuration', 'bright'));
  console.log('='.repeat(60) + '\n');

  const current = getUserConfig();

  console.log('Current settings:');
  console.log(`  Workspaces directory:    ${colorize(current.workspacesDir, 'cyan')}`);
  console.log(`  GitHub organization:     ${colorize(current.githubOrg, 'cyan')}`);
  console.log(`  Clone protocol:          ${colorize(current.cloneProtocol, 'cyan')}`);
  console.log(`  Auto-launch agent:       ${current.autoLaunchClaude ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
  console.log(`  Generate context file:   ${current.generateClaudeContext ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
  console.log(`  MCP server:              ${current.installMcp ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
  console.log(`  AI Agent:                ${colorize(current.aiAgent, 'cyan')}`);
  console.log(`  Primary agent:           ${colorize(current.primaryAgent, 'cyan')}`);
  console.log(`  Pi workspace widget:     ${current.piWorkspaceInputStatus !== false ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
  console.log(`  Claude workspace table:  ${current.claudeWorkspaceStatusLine !== false ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
  console.log('');

  try {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'workspacesDir', message: 'Workspaces directory:', default: current.workspacesDir, validate: (val: string) => val.trim().length > 0 || 'Directory path is required' },
      { type: 'input', name: 'githubOrg', message: 'GitHub organization:', default: current.githubOrg, validate: (val: string) => /^[a-zA-Z0-9_-]+$/.test(val.trim()) || 'Must be a valid GitHub org name' },
      { type: 'list', name: 'cloneProtocol', message: 'Clone protocol:', choices: [{ name: 'SSH  (git@github.com:...)', value: 'ssh' }, { name: 'HTTPS (https://github.com/...)', value: 'https' }], default: current.cloneProtocol },
      { type: 'confirm', name: 'autoLaunchClaude', message: 'Auto-launch AI agent after workspace creation?', default: current.autoLaunchClaude },
      { type: 'confirm', name: 'generateClaudeContext', message: 'Generate context file in workspaces?', default: current.generateClaudeContext },
      { type: 'confirm', name: 'installMcp', message: 'Install MCP server (Claude Code only)?', default: current.installMcp },
      { type: 'list', name: 'aiAgent', message: 'AI Agent(s) to integrate with:', choices: [
        { name: 'Auto-detect (recommended)', value: 'auto' },
        { name: 'Claude Code only', value: 'claude' },
        { name: 'Pi only', value: 'pi' },
        { name: 'OpenCode only', value: 'opencode' },
        { name: 'All available', value: 'both' },
      ], default: current.aiAgent },
      // Only ask about primary agent when aiAgent is 'both' or 'auto'
      // (when specific agent chosen, primary is implicitly that agent)
      { type: 'list', name: 'primaryAgent', message: 'Primary agent (used for launching):', choices: [
        { name: 'Auto-detect (first available)', value: 'auto' },
        { name: 'Claude Code', value: 'claude' },
        { name: 'Pi', value: 'pi' },
        { name: 'OpenCode', value: 'opencode' },
      ], default: current.primaryAgent, when: (ans) => ans.aiAgent === 'both' || ans.aiAgent === 'auto' },
      { type: 'confirm', name: 'piWorkspaceInputStatus',
        message: 'Show workspace status widget in Pi input area (branch, PRs, CI)?',
        default: current.piWorkspaceInputStatus !== false,
        when: (ans) => ans.aiAgent === 'pi' || ans.aiAgent === 'both' || ans.aiAgent === 'auto' },
      { type: 'confirm', name: 'claudeWorkspaceStatusLine',
        message: 'Add workspace repo table to Claude Code status line?',
        default: current.claudeWorkspaceStatusLine !== false,
        when: (ans) => ans.aiAgent === 'claude' || ans.aiAgent === 'both' || ans.aiAgent === 'auto' },
      { type: 'confirm', name: 'autoReportBugs',
        message: 'Auto-file a GitHub issue when a command crashes? (deduped, sanitized)',
        default: current.autoReportBugs === true },
    ]);

    // Validate and normalize config
    let primaryAgent = answers.primaryAgent || 'auto';
    // If aiAgent is specific, primaryAgent must match
    if (answers.aiAgent === 'claude') primaryAgent = 'claude';
    if (answers.aiAgent === 'pi') primaryAgent = 'pi';
    if (answers.aiAgent === 'opencode') primaryAgent = 'opencode';

    const newConfig: UserConfig = {
      workspacesDir: answers.workspacesDir.trim(),
      githubOrg: answers.githubOrg.trim(),
      cloneProtocol: answers.cloneProtocol,
      autoLaunchClaude: answers.autoLaunchClaude,
      generateClaudeContext: answers.generateClaudeContext,
      installMcp: answers.installMcp,
      aiAgent: answers.aiAgent,
      primaryAgent,
      piWorkspaceInputStatus: answers.piWorkspaceInputStatus ?? current.piWorkspaceInputStatus ?? true,
      claudeWorkspaceStatusLine: answers.claudeWorkspaceStatusLine ?? current.claudeWorkspaceStatusLine ?? true,
      autoReportBugs: answers.autoReportBugs ?? current.autoReportBugs ?? false,
    };

    saveUserConfig(newConfig);

    console.log('');
    logSuccess('Configuration saved!');
    console.log('');
    console.log(`  ${colorize('Workspaces directory:', 'gray')}  ${newConfig.workspacesDir}`);
    console.log(`  ${colorize('GitHub organization:', 'gray')}   ${newConfig.githubOrg}`);
    console.log(`  ${colorize('Clone protocol:', 'gray')}        ${newConfig.cloneProtocol}`);
    console.log(`  ${colorize('Auto-launch agent:', 'gray')}     ${newConfig.autoLaunchClaude ? 'Yes' : 'No'}`);
    console.log(`  ${colorize('Generate context:', 'gray')}       ${newConfig.generateClaudeContext ? 'Yes' : 'No'}`);
    console.log(`  ${colorize('MCP server:', 'gray')}            ${newConfig.installMcp ? 'Yes' : 'No'}`);
    console.log(`  ${colorize('AI Agent:', 'gray')}              ${newConfig.aiAgent}`);
    console.log(`  ${colorize('Primary agent:', 'gray')}         ${newConfig.primaryAgent}`);
    console.log('');

    // Install / upgrade shell integration.
    // Skip if MCP install just ran it (mcp/install always installs shell integration).
    let mcpInstalled = false;
    if (newConfig.installMcp && !current.installMcp) {
      logInfo('Installing MCP server...');
      try {
        const mcpInstallScript = path.join(__dirname, '..', '..', 'dist', 'mcp', 'install.js');
        execSync(`node "${mcpInstallScript}" install`, { stdio: 'inherit' });
        mcpInstalled = true;
      } catch { logError('MCP install failed. You can retry later with: w mcp install'); }
    }

    if (newConfig.githubOrg !== current.githubOrg) {
      await clearCache();
      logInfo(`GitHub org changed from "${current.githubOrg}" to "${newConfig.githubOrg}". Repo cache has been cleared.`);
    }

    // Always install / upgrade the shell integration so the 'w' function
    // is available. This is especially important on first-time setup where
    // postinstall may not have run or the user hasn't sourced their RC file.
    // Skip if mcp install already did it to avoid printing the reminder twice.
    if (!mcpInstalled) {
      installShellIntegration();
    }

  } catch (error) {
    logError('Failed to save configuration');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}

/**
 * Install or upgrade the shell integration (w/workspace shell functions).
 * Uses an absolute path derived from this file so it works regardless of CWD.
 * Always prints a prominent "source your RC file" reminder afterwards.
 */
function installShellIntegration(): void {
  // __dirname is dist/commands/ at runtime — script is two levels up at package root
  const scriptPath = path.join(__dirname, '..', '..', 'install-shell-integration.sh');

  if (!fs.existsSync(scriptPath)) {
    logWarning('Shell integration script not found — skipping auto-install');
    printSourceReminder();
    return;
  }

  const shell = process.env.SHELL || '';
  const shellType = shell.endsWith('/zsh') ? 'zsh'
    : shell.endsWith('/bash') ? 'bash'
    : '';

  if (!shellType) {
    logWarning('Unknown shell — skipping shell integration (run install-shell-integration.sh manually)');
    printSourceReminder();
    return;
  }

  try {
    execSync(`bash "${scriptPath}" ${shellType}`, { stdio: 'inherit' });
  } catch {
    logWarning('Shell integration install failed — you can run it manually:');
    logInfo(`  bash "${scriptPath}" ${shellType}`);
  }

  printSourceReminder();
}

/**
 * Print a loud, impossible-to-miss reminder to source the RC file.
 * Without this step the 'w' shell function is not available in the
 * current terminal session even after a successful install.
 */
function printSourceReminder(): void {
  const shell = process.env.SHELL || '';
  const rcFile = shell.endsWith('/zsh') ? '~/.zshrc'
    : shell.endsWith('/bash') ? '~/.bashrc'
    : '~/.profile';

  console.log('');
  console.log(colorize('  ⚠️  IMPORTANT — activate the shell function in this session:', 'yellow'));
  console.log('');
  console.log(`     ${colorize(`source ${rcFile}`, 'cyan')}`);
  console.log('');
  console.log(`  Or open a new terminal tab. Until then, ${colorize('w', 'cyan')} resolves to the`);
  console.log(`  Unix ${colorize('w', 'gray')} command (shows logged-in users), not workspace manager.`);
  console.log('');
  console.log(`  Tip: ${colorize('workspace', 'cyan')} works immediately without sourcing:`);
  console.log(`       ${colorize('workspace configure', 'cyan')}   ${colorize('# first-time setup', 'gray')}`);
  console.log(`       ${colorize('workspace list', 'cyan')}        ${colorize('# list workspaces', 'gray')}`);
  console.log('');
}
