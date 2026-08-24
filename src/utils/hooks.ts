import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { RepositoryMetadata, PostCloneHook } from '../types';
import { logInfo, logSuccess, logError, logWarning } from './logger';
import { colorize } from './colors';

const execAsync = promisify(exec);

const HOOK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface HookResult {
  repo: string;
  command: string;
  status: 'success' | 'failed';
  error?: string;
}

export async function runPostCloneHooks(
  workspacePath: string,
  repositories: RepositoryMetadata[],
  hooks?: PostCloneHook[]
): Promise<HookResult[]> {
  if (!hooks || hooks.length === 0) {
    return [];
  }

  const results: HookResult[] = [];

  logInfo('Running post-clone hooks...');
  console.log('');

  for (const hook of hooks) {
    if (hook.description) {
      logInfo(`Hook: ${colorize(hook.description, 'cyan')}`);
    }

    // Determine target repos
    const targetRepos = hook.repoName
      ? repositories.filter(r => r.name === hook.repoName || r.directoryName === hook.repoName)
      : repositories;

    if (targetRepos.length === 0) {
      if (hook.repoName) {
        logWarning(`No matching repo found for hook target: ${hook.repoName}`);
      }
      continue;
    }

    for (const repo of targetRepos) {
      const repoPath = path.join(workspacePath, repo.directoryName);

      for (const command of hook.commands) {
        try {
          logInfo(`  [${colorize(repo.directoryName, 'cyan')}] ${command}`);
          await execAsync(command, { cwd: repoPath, timeout: HOOK_TIMEOUT });

          results.push({
            repo: repo.directoryName,
            command,
            status: 'success',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          results.push({
            repo: repo.directoryName,
            command,
            status: 'failed',
            error: errorMessage,
          });

          logError(`  [${repo.directoryName}] Failed: ${errorMessage}`);

          if (!hook.continueOnError) {
            logWarning('Hook execution stopped due to error (continueOnError is false)');
            return results;
          }
        }
      }
    }
  }

  // Log summary
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;

  console.log('');
  logInfo(`Hook results: ${colorize(String(successful), 'green')} successful, ${colorize(String(failed), 'red')} failed`);

  return results;
}
