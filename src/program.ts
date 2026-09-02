import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { setColorEnabled } from './utils/colors';
import { renderHelpBanner } from './utils/banner';
import { applyGlobalFlags } from './utils/global-flags';

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

// --no-color must be applied BEFORE commander parses so it reaches the help
// banner (a preAction hook is too late for help output, and ES imports run
// before hooks). It's a long flag, so it can't be bundled — an argv scan is
// sufficient here. colors.ts already applied NO_COLOR / non-TTY at import.
// --quiet is handled in the preAction hook below (it only affects command
// logs, never help), which also catches bundled short forms like `-yq`.
if (process.argv.includes('--no-color')) setColorEnabled(false);

export const program = new Command();

program
  .name('workspace')
  .description('Multi-repo workspace manager')
  .version(pkg.version, '-V, --version')
  .option('-f, --force-refresh', 'Force refresh GitHub repos (skip cache)')
  .option('-y, --yes', 'Skip confirmations')
  .option('--no-color', 'Disable colored output (also honors NO_COLOR)')
  .option('-q, --quiet', 'Suppress progress logs (keep warnings + errors)')
  .addHelpText('before', () => renderHelpBanner(pkg.version));

// Apply global --quiet / --color from commander's PARSED options (robust to
// bundled short flags like `-yq` that a raw argv scan misses). Runs before every
// command action; help output doesn't reach here, which is why --no-color is
// also pre-scanned above.
program.hook('preAction', () => applyGlobalFlags(program.opts()));

// Register top-level commands
import { registerCreateCommand } from './commands/create';
import { registerListCommand } from './commands/list';
import { registerUpdateCommand } from './commands/update';
import { registerDeleteCommand } from './commands/delete';
import { registerPruneCommand } from './commands/prune';
import { registerSyncCommand } from './commands/sync';
import { registerStatusCommand } from './commands/status';
import { registerDiffCommand } from './commands/diff';
import { registerRunCommand } from './commands/run';
import { registerGoCommand } from './commands/go';
import { registerDoctorCommand } from './commands/doctor';
import { registerAnalyzeDepsCommand } from './commands/analyze-deps';
import { registerHistoryCommand } from './commands/history';
import { registerCleanupCommand } from './commands/cleanup';
import { registerRemoveRepoCommand } from './commands/remove-repo';
import { registerArchiveCommand } from './commands/archive';
import { registerSessionsCommand } from './commands/sessions';
import { registerGenerateDocsCommand } from './commands/generate-docs';
import { registerConfigureCommand } from './commands/configure';
import { registerConfigCommand } from './commands/config';
import { registerConfigureClaudeCommand } from './commands/configure-claude';
import { registerGhqStatusCommand } from './commands/ghq-status';
import { registerSaveContextCommand } from './commands/save-context';
import { registerMigrateCommand } from './commands/migrate';
import { registerReportBugCommand } from './commands/report-bug';
import { registerCompletionCommand } from './commands/completion';
import { registerReflectCommand } from './commands/reflect';

registerCreateCommand(program);
registerListCommand(program);
registerUpdateCommand(program);
registerDeleteCommand(program);
registerPruneCommand(program);
registerSyncCommand(program);
registerStatusCommand(program);
registerDiffCommand(program);
registerRunCommand(program);
registerGoCommand(program);
registerDoctorCommand(program);
registerAnalyzeDepsCommand(program);
registerHistoryCommand(program);
registerCleanupCommand(program);
registerRemoveRepoCommand(program);
registerArchiveCommand(program);
registerSessionsCommand(program);
registerGenerateDocsCommand(program);
registerConfigureCommand(program);
registerConfigCommand(program);
registerConfigureClaudeCommand(program);
registerGhqStatusCommand(program);
registerSaveContextCommand(program);
registerMigrateCommand(program);
registerReportBugCommand(program);
registerCompletionCommand(program);
registerReflectCommand(program);

// Register TUI (delegates to existing Ink/React implementation)
program
  .command('tui')
  .description('Launch interactive terminal UI')
  .action(async () => {
    const { main } = await import('./cli/tui');
    await main();
  });

// Register dashboard command
import { registerDashboardCommand } from './commands/dashboard';
registerDashboardCommand(program);

// Register grouped commands
import { registerSuiteCommands } from './commands/suite';
import { registerBranchCommands } from './commands/branch';
import { registerCacheCommands } from './commands/cache';
import { registerMcpCommands } from './commands/mcp';

registerSuiteCommands(program);
registerBranchCommands(program);
registerCacheCommands(program);
registerMcpCommands(program);

// Register deprecated aliases
import { registerDeprecatedAliases } from './commands/deprecated-aliases';
registerDeprecatedAliases(program);
