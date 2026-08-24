import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { logInfo, logSuccess, logError, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import {
  reportBug,
  readLastError,
  type CapturedError,
  BUG_REPORT_REPO,
} from '../utils/bug-report';

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function registerReportBugCommand(parent: Command) {
  parent
    .command('report-bug')
    .description('File the last error (or a custom message) as a GitHub issue')
    .option('-m, --message <message>', 'Report a custom message instead of the last captured error')
    .option('-f, --force', 'Report even if the error looks environmental (network/auth)')
    .action(async (opts: { message?: string; force?: boolean }) => {
      await handleReportBug(opts);
    });
}

async function handleReportBug(opts: { message?: string; force?: boolean }): Promise<void> {
  let captured: CapturedError | null;

  if (opts.message) {
    captured = {
      command: 'w report-bug (manual)',
      message: opts.message,
      timestamp: new Date().toISOString(),
      version: getVersion(),
    };
  } else {
    captured = readLastError();
    if (!captured) {
      logError('No recent error to report.');
      logInfo('Run a command that fails first, or use: w report-bug -m "describe the bug"');
      process.exit(1);
      return;
    }
    // Show which error we're about to report (with its age). Some failures
    // — notably `w -- <prompt>` — exit without updating last-error.json, so
    // the most recent capture could be an older crash. Surfacing the
    // timestamp lets the user catch a stale report before filing.
    const ageMs = Date.now() - new Date(captured.timestamp).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const when = Number.isFinite(ageMin)
      ? (ageMin < 1 ? 'just now' : `${ageMin} min ago`)
      : 'unknown time';
    logInfo(`Last captured error (${when}): ${colorize(captured.command, 'cyan')}`);
    logInfo(`  ${captured.message.split('\n')[0].slice(0, 100)}`);
    if (ageMin >= 10) {
      logWarning(`This error is ${ageMin} min old — make sure it's the one you mean to report.`);
      logInfo('Tip: pass -m "..." to report a specific message instead.');
    }
  }

  logInfo(`Reporting to ${colorize(BUG_REPORT_REPO, 'cyan')}...`);
  const result = reportBug(captured, getVersion(), { force: opts.force });

  switch (result.status) {
    case 'created':
      logSuccess(`Bug issue created: ${colorize(result.url!, 'cyan')}`);
      break;
    case 'duplicate':
      logInfo(`This error was already reported: ${colorize(result.url!, 'cyan')}`);
      logInfo('Subscribe there for updates — no duplicate filed.');
      break;
    case 'skipped':
      logWarning(result.reason || 'Skipped.');
      break;
    case 'failed':
      logError(result.reason || 'Failed to file the bug report.');
      process.exit(1);
  }
}
