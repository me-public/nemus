import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { resolveWorkspace } from '../utils/command-helpers';
import { runInRepo, RunResult } from '../utils/run-operations';

const CONCURRENCY_LIMIT = 3;

export function registerRunCommand(parent: Command) {
  parent
    .command('run')
    .alias('r')
    .description('Run command across all repos')
    .argument('[workspace]', 'Workspace name')
    .argument('[command...]', 'Command to run (use quotes for flags: "git status -s")')
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (workspace, commandParts) => {
      // Commander parses positional args correctly even with allowUnknownOption.
      // workspace = first positional, commandParts = rest as array.
      // Unknown options (like -s in "git status -s") end up in commandParts too.
      if (!workspace && (!commandParts || commandParts.length === 0)) {
        // No args at all
        await handleRun(undefined, []);
      } else if (!commandParts || commandParts.length === 0) {
        // Single arg: treat as command, prompt for workspace
        await handleRun(undefined, [workspace]);
      } else {
        // First arg is workspace, rest is command
        await handleRun(workspace, commandParts);
      }
    });
}

async function handleRun(workspaceArg?: string, commandParts?: string[]) {
  try {
    let workspaceName: string;
    let command: string;

    if (!commandParts || commandParts.length === 0) {
      if (!workspaceArg) {
        logError('Usage: w run [workspace-name] "<command>"');
        process.exit(1);
      }
      // Only one arg: treat as command, prompt for workspace
      command = workspaceArg;
      workspaceName = await resolveWorkspace();
    } else if (!workspaceArg) {
      // commandParts provided but no workspace — treat first part as command
      command = commandParts.join(' ');
      workspaceName = await resolveWorkspace();
    } else {
      // Both workspace and command provided
      workspaceName = workspaceArg;
      command = commandParts.join(' ');
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace metadata not found for: ${workspaceName}`);
      process.exit(1);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');

    console.log('\n' + colorize('Run Command Across Workspace', 'bright'));
    console.log(`Workspace: ${colorize(workspaceName, 'cyan')}`);
    console.log(`Command:   ${colorize(command, 'yellow')}`);
    console.log(`Repos:     ${repos.length}\n`);

    const results: RunResult[] = [];

    for (let i = 0; i < repos.length; i += CONCURRENCY_LIMIT) {
      const chunk = repos.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.all(
        chunk.map(repo => {
          const repoPath = path.join(workspacePath, repo.directoryName);
          const displayName = repo.directoryName !== repo.name
            ? `${repo.directoryName} (${repo.name})`
            : repo.name;
          return runInRepo(repoPath, displayName, command);
        })
      );
      results.push(...chunkResults);
    }

    console.log(colorize('═'.repeat(60), 'gray'));
    for (const result of results) {
      const icon = result.status === 'success'
        ? colorize('✓', 'green')
        : colorize('✗', 'red');

      console.log(`\n${icon} ${colorize(result.repo, 'cyan')}`);

      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.log(colorize(result.stderr, 'yellow'));
      }
    }

    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    console.log('\n' + colorize('═'.repeat(60), 'gray'));
    console.log(`${colorize('✓', 'green')} ${successful} successful, ${colorize('✗', 'red')} ${failed} failed`);
    console.log('');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logError('Failed to run command');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}
