import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { GitHubRepo } from '../types';
import { logError, logInfo } from './logger';
import { getCachedRepos, setCachedRepos } from './cache';
import { getUserConfig } from './config';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const verifyGhAuth = async (): Promise<boolean> => {
  try {
    const { stdout } = await execAsync('gh auth status');
    return stdout.includes('Logged in') || stdout.includes('✓');
  } catch (error) {
    return false;
  }
};

export const fetchOrgRepos = async (options: { forceRefresh?: boolean } = {}): Promise<GitHubRepo[]> => {
  const { forceRefresh = false } = options;

  try {
    const { githubOrg } = getUserConfig();

    // Try to get cached repos first
    if (!forceRefresh) {
      const cachedRepos = await getCachedRepos({ org: githubOrg });
      if (cachedRepos) {
        return cachedRepos.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    logInfo(
      githubOrg
        ? `Fetching ${githubOrg} repositories from GitHub...`
        : 'Fetching your GitHub repositories... (set an org with `nemus configure` to list an organization)'
    );

    // With no configured org, `gh repo list` (no positional) lists the
    // authenticated user's own repos. With an org, it lists that org's repos.
    const args = [
      'repo', 'list',
      ...(githubOrg ? [githubOrg] : []),
      '--limit', '1000',
      '--json', 'name,url,sshUrl,owner,description,isPrivate',
    ];
    const { stdout } = await execFileAsync('gh', args);

    const repos: GitHubRepo[] = JSON.parse(stdout);

    logInfo(`Found ${repos.length} repositories`);

    // Cache the results (24 hour TTL)
    await setCachedRepos(repos, 86400000, githubOrg);

    return repos.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    logError('Failed to fetch repositories from GitHub');
    if (error instanceof Error) {
      logError(error.message);
    }
    throw new Error('Unable to fetch repositories. Please ensure gh CLI is authenticated.');
  }
};

export const displayAuthInstructions = (): void => {
  console.log('\n' + '='.repeat(60));
  console.log('GitHub CLI Authentication Required');
  console.log('='.repeat(60));
  console.log('\nPlease authenticate with GitHub CLI by running:');
  console.log('\n  gh auth login\n');
  console.log('Then try running this command again.');
  console.log('='.repeat(60) + '\n');
};
