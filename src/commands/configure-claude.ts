import { Command } from 'commander';
import { loadClaudeConfig, saveClaudeConfig } from '../utils/claude-integration';
import { logSuccess, logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';

export function registerConfigureClaudeCommand(parent: Command) {
  parent
    .command('configure-claude')
    .alias('cc')
    .description('Configure Claude Code integration')
    .action(async () => {
      await handleConfigureClaude();
    });
}

async function handleConfigureClaude() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Configure Claude Code Integration', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const currentConfig = await loadClaudeConfig();

    console.log('Current settings:');
    console.log(`  Auto-launch Claude: ${currentConfig.autoLaunch ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
    console.log(`  Generate context: ${currentConfig.generateContext ? colorize('Enabled', 'green') : colorize('Disabled', 'red')}`);
    console.log('');

    const answers = await inquirer.prompt([
      { type: 'confirm', name: 'autoLaunch', message: 'Auto-launch Claude Code after workspace creation?', default: currentConfig.autoLaunch },
      { type: 'confirm', name: 'generateContext', message: 'Generate CLAUDE.md context file in workspaces?', default: currentConfig.generateContext },
    ]);

    await saveClaudeConfig(answers);

    console.log('');
    logSuccess('Claude Code integration configured!');
    console.log('');
    console.log('Settings:');
    console.log(`  ${colorize('✓', 'green')} Auto-launch: ${answers.autoLaunch ? 'Enabled' : 'Disabled'}`);
    console.log(`  ${colorize('✓', 'green')} Generate context: ${answers.generateContext ? 'Enabled' : 'Disabled'}`);

    if (answers.autoLaunch) {
      console.log('');
      console.log(colorize('Note:', 'yellow') + ' Claude Code will automatically launch when you create workspaces.');
      console.log('Make sure Claude Code CLI is installed: https://claude.ai/download');
    }
    console.log('');
  } catch (error) {
    logError('Failed to configure Claude integration');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
