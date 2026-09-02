import { Command } from 'commander';
import { getGhqStatus, displayGhqInfo, ghqList } from '../utils/ghq-integration';
import { logSuccess, logWarning, logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { confirm } from '../utils/prompt';

export function registerGhqStatusCommand(parent: Command) {
  parent
    .command('ghq-status')
    .description('Check ghq integration status')
    .action(async () => {
      await handleGhqStatus();
    });
}

async function handleGhqStatus() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('ghq Integration Status', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const status = await getGhqStatus();

    if (status.installed) {
      logSuccess('ghq is installed and active');
      console.log('');
      console.log(colorize('Configuration:', 'cyan'));
      console.log(`  Root directory: ${colorize(status.root || 'unknown', 'gray')}`);
      console.log(`  Managed repositories: ${colorize(String(status.repoCount || 0), 'yellow')}`);
      console.log('');

      if (status.repoCount && status.repoCount > 0) {
        const showRepos = await confirm({
          message: `View all ${status.repoCount} managed repositories?`, default: false,
        });

        if (showRepos) {
          const repos = await ghqList();
          console.log('');
          console.log(colorize('Managed Repositories:', 'cyan'));
          repos.forEach((repo, index) => { console.log(`  ${index + 1}. ${repo}`); });
          console.log('');
        }
      }
    } else {
      logWarning('ghq is not installed');
      console.log('');
      console.log('The workspace manager will use direct git clones.');

      const showInfo = await confirm({
        message: 'Show ghq installation information?', default: true,
      });

      if (showInfo) { displayGhqInfo(); }
    }

    console.log(colorize('Nemus Behavior:', 'cyan'));
    console.log('  • Auto-detects ghq installation');
    console.log('  • Uses ghq when available');
    console.log('  • Falls back to git clone if needed');
    console.log('  • Always maintains workspace isolation');
    console.log('');
  } catch (error) {
    logError('Failed to check ghq status');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
