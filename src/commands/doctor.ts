import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { runAllHealthChecks, calculateHealthScore } from '../utils/health-checks';
import { logError, logInfo, logStep, logSuccess, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { HealthCheckResult } from '../types';
import { resolveWorkspace } from '../utils/command-helpers';

const displayHealthCheck = (result: HealthCheckResult) => {
  let statusIcon = '';
  let statusColor: 'green' | 'yellow' | 'red' = 'green';

  switch (result.status) {
    case 'healthy':
      statusIcon = '✓';
      statusColor = 'green';
      break;
    case 'warning':
      statusIcon = '⚠';
      statusColor = 'yellow';
      break;
    case 'error':
      statusIcon = '✗';
      statusColor = 'red';
      break;
  }

  console.log(`\n${colorize(statusIcon, statusColor)} ${colorize(result.category, 'bright')}`);
  console.log(`  ${result.message}`);
  if (result.details) {
    console.log(`  ${colorize('Details:', 'gray')} ${result.details}`);
  }
  if (result.actionable) {
    console.log(`  ${colorize('→', 'cyan')} ${result.actionable}`);
  }
};

const displayHealthScore = (score: number) => {
  let scoreColor: 'green' | 'yellow' | 'red' = 'green';
  let rating = 'Excellent';

  if (score >= 80) { scoreColor = 'green'; rating = 'Excellent'; }
  else if (score >= 60) { scoreColor = 'yellow'; rating = 'Good'; }
  else if (score >= 40) { scoreColor = 'yellow'; rating = 'Fair'; }
  else { scoreColor = 'red'; rating = 'Poor'; }

  console.log('\n' + colorize('═'.repeat(60), 'gray'));
  console.log(
    `${colorize('Overall Health Score:', 'bright')} ${colorize(String(score), scoreColor)}/100 (${colorize(rating, scoreColor)})`
  );
  console.log(colorize('═'.repeat(60), 'gray') + '\n');
};

export function registerDoctorCommand(parent: Command) {
  parent
    .command('doctor')
    .alias('doc')
    .description('Run comprehensive health checks')
    .argument('[workspace]', 'Workspace name')
    .action(async (workspace) => {
      await handleDoctor(workspace);
    });
}

async function handleDoctor(workspaceArg?: string) {
  try {
    const selectedWorkspace = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, selectedWorkspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace metadata not found for: ${selectedWorkspace}`);
      process.exit(1);
    }

    logStep(`Running health checks for workspace: ${colorize(selectedWorkspace, 'cyan')}`);
    logInfo('This may take a moment...');

    const results = await runAllHealthChecks(workspacePath, metadata);
    const score = calculateHealthScore(results);

    console.log('\n' + colorize('Health Check Results', 'bright'));
    console.log(colorize('═'.repeat(60), 'gray'));

    for (const result of results) {
      displayHealthCheck(result);
    }

    displayHealthScore(score);

    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => r.status === 'warning');

    if (hasErrors) {
      logError('Critical issues detected. Please address error items above.');
    } else if (hasWarnings) {
      logWarning('Some warnings detected. Review and address when possible.');
    } else {
      logSuccess('All health checks passed! Your workspace is in good shape.');
    }
  } catch (error) {
    logError('Failed to run health checks');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
