import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { resolveWorkspace, getGlobalOpts, parseList } from '../utils/command-helpers';
import { resolveDevCommand, runDev, type DevService } from '../utils/dev-orchestrator';
import { logError, logInfo, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';

export function registerDevCommand(parent: Command) {
  parent
    .command('dev [workspace]')
    .description('Start every repo\'s dev server together, with unified color-coded logs (Ctrl-C stops all)')
    .option('--only <repos>', 'Comma-separated subset of repos to start')
    .option('--script <name>', 'npm script to prefer (default: dev → develop → start → serve)')
    .option('--command <cmd>', 'Run this exact command in every selected repo instead of a script')
    .option('--exit-on-failure', 'Tear everything down if any service exits non-zero')
    .option('--kill-timeout <seconds>', 'Grace period before SIGKILL on shutdown', '5')
    .action(async (workspace, opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleDev({ workspace, ...opts, ...globalOpts });
    });
}

async function handleDev(opts: {
  workspace?: string;
  only?: string;
  script?: string;
  command?: string;
  exitOnFailure?: boolean;
  killTimeout?: string;
}) {
  try {
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);

    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    let repos = metadata.repositories.filter(r => r.status === 'success');

    if (opts.only) {
      const wanted = new Set(parseList(opts.only));
      repos = repos.filter(r => wanted.has(r.directoryName) || wanted.has(r.name));
      if (repos.length === 0) {
        logError(`No repos in "${workspaceName}" matched --only ${opts.only}`);
        process.exit(1);
      }
    }

    const services: DevService[] = [];
    const skipped: string[] = [];
    for (const repo of repos) {
      const cwd = path.join(workspacePath, repo.directoryName);
      const command = resolveDevCommand(cwd, { commandOverride: opts.command, script: opts.script });
      if (!command) {
        skipped.push(repo.directoryName);
        continue;
      }
      services.push({ label: repo.directoryName, cwd, command });
    }

    if (services.length === 0) {
      logError(`Nothing to run in "${workspaceName}".`);
      logInfo(opts.script
        ? `No repo has a "${opts.script}" script.`
        : 'No repo has a dev/develop/start/serve script. Pass --command "<cmd>" to run something explicitly.');
      process.exit(1);
    }

    if (skipped.length > 0) {
      logWarning(`Skipped (no runnable script): ${skipped.join(', ')}`);
    }

    console.log('\n' + colorize('Starting dev servers', 'bright') + colorize(` · ${workspaceName}`, 'cyan'));
    for (const s of services) {
      console.log(`  ${colorize(s.label, 'cyan')}  ${colorize(s.command.command, 'gray')} ${colorize(`(${s.command.source})`, 'gray')}`);
    }
    console.log(colorize('  Ctrl-C to stop all.\n', 'gray'));

    const killTimeoutMs = Math.max(0, Number(opts.killTimeout) || 5) * 1000;
    const code = await runDev(services, {
      exitOnFailure: opts.exitOnFailure,
      killTimeoutMs,
    });
    process.exit(code);
  } catch (error) {
    logError('Failed to start dev servers');
    if (error instanceof Error) logError(error.message);
    process.exit(1);
  }
}
