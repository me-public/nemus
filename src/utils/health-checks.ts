import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HealthCheckResult, WorkspaceMetadata } from '../types';
import { isGitRepository, hasUncommittedChanges } from './git-status';

const execAsync = promisify(exec);

export const checkMissingRepositories = async (
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<HealthCheckResult> => {
  const missingRepos: string[] = [];

  for (const repo of metadata.repositories) {
    const repoPath = path.join(workspacePath, repo.directoryName);
    try {
      await fs.access(repoPath);
    } catch {
      missingRepos.push(repo.directoryName);
    }
  }

  if (missingRepos.length === 0) {
    return {
      category: 'Missing Repositories',
      status: 'healthy',
      message: 'All repositories are present',
    };
  }

  return {
    category: 'Missing Repositories',
    status: 'error',
    message: `${missingRepos.length} repository(ies) missing`,
    details: missingRepos.join(', '),
    actionable: `Run 'workspace sync ${metadata.workspaceName}' to clone missing repositories`,
  };
};

export const checkGitHealth = async (
  workspacePath: string,
  repoNames: string[]
): Promise<HealthCheckResult> => {
  const issues: string[] = [];

  for (const repoName of repoNames) {
    const repoPath = path.join(workspacePath, repoName);

    try {
      await fs.access(repoPath);
    } catch {
      continue; // Skip missing repos (handled by checkMissingRepositories)
    }

    const isRepo = await isGitRepository(repoPath);
    if (!isRepo) {
      issues.push(`${repoName}: not a git repository`);
      continue;
    }

    // Check for corrupted repo
    try {
      await execAsync('git fsck --no-progress', {
        cwd: repoPath,
        timeout: 30000,
      });
    } catch (error) {
      issues.push(`${repoName}: repository may be corrupted`);
    }
  }

  if (issues.length === 0) {
    return {
      category: 'Git Health',
      status: 'healthy',
      message: 'All repositories are healthy',
    };
  }

  return {
    category: 'Git Health',
    status: 'error',
    message: `${issues.length} repository(ies) have issues`,
    details: issues.join('\n'),
    actionable: 'Check repository integrity and consider re-cloning problematic repos',
  };
};

export const checkUncommittedChanges = async (
  workspacePath: string,
  repoNames: string[]
): Promise<HealthCheckResult> => {
  const dirtyRepos: string[] = [];

  for (const repoName of repoNames) {
    const repoPath = path.join(workspacePath, repoName);

    try {
      await fs.access(repoPath);
    } catch {
      continue;
    }

    const hasChanges = await hasUncommittedChanges(repoPath);
    if (hasChanges) {
      dirtyRepos.push(repoName);
    }
  }

  if (dirtyRepos.length === 0) {
    return {
      category: 'Uncommitted Changes',
      status: 'healthy',
      message: 'No uncommitted changes',
    };
  }

  return {
    category: 'Uncommitted Changes',
    status: 'warning',
    message: `${dirtyRepos.length} repository(ies) have uncommitted changes`,
    details: dirtyRepos.join(', '),
    actionable: `Review and commit or stash changes before switching branches`,
  };
};

export const checkAuthentication = async (): Promise<HealthCheckResult> => {
  const issues: string[] = [];

  // Check GitHub CLI
  try {
    await execAsync('gh auth status', { timeout: 5000 });
  } catch {
    issues.push('GitHub CLI (gh) not authenticated');
  }

  // Check SSH keys
  try {
    await execAsync('ssh -T git@github.com', { timeout: 5000 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '';
    if (!errorMessage.includes('successfully authenticated')) {
      issues.push('SSH key not configured for GitHub');
    }
  }

  if (issues.length === 0) {
    return {
      category: 'Authentication',
      status: 'healthy',
      message: 'Authentication configured correctly',
    };
  }

  return {
    category: 'Authentication',
    status: 'warning',
    message: 'Authentication issues detected',
    details: issues.join('\n'),
    actionable: 'Run "gh auth login" or configure SSH keys',
  };
};

export const checkDependencies = async (
  workspacePath: string,
  repoNames: string[]
): Promise<HealthCheckResult> => {
  const missingDeps: string[] = [];

  for (const repoName of repoNames) {
    const repoPath = path.join(workspacePath, repoName);

    try {
      await fs.access(repoPath);
    } catch {
      continue;
    }

    // Check for package.json
    const packageJsonPath = path.join(repoPath, 'package.json');
    try {
      await fs.access(packageJsonPath);

      // Check if node_modules exists
      const nodeModulesPath = path.join(repoPath, 'node_modules');
      try {
        await fs.access(nodeModulesPath);
      } catch {
        missingDeps.push(`${repoName}: missing node_modules`);
      }
    } catch {
      // No package.json, skip
    }
  }

  if (missingDeps.length === 0) {
    return {
      category: 'Dependencies',
      status: 'healthy',
      message: 'All dependencies installed',
    };
  }

  return {
    category: 'Dependencies',
    status: 'warning',
    message: `${missingDeps.length} repository(ies) missing dependencies`,
    details: missingDeps.join('\n'),
    actionable: 'Run "npm install" or "yarn install" in affected repositories',
  };
};

export const checkDiskSpace = async (workspacePath: string): Promise<HealthCheckResult> => {
  try {
    // Get disk usage for workspace
    const { stdout } = await execAsync(`du -sh "${workspacePath}"`, { timeout: 30000 });
    const sizeStr = stdout.trim().split('\t')[0];

    // Parse size (rough check for > 10GB)
    const sizeValue = parseFloat(sizeStr);
    const unit = sizeStr.replace(/[0-9.]/g, '').trim();

    const isLarge = (unit === 'G' && sizeValue > 10) || unit === 'T';

    if (isLarge) {
      return {
        category: 'Disk Space',
        status: 'warning',
        message: `Workspace is large (${sizeStr})`,
        actionable: 'Consider running "workspace cleanup" to free up space',
      };
    }

    return {
      category: 'Disk Space',
      status: 'healthy',
      message: `Workspace size: ${sizeStr}`,
    };
  } catch (error) {
    return {
      category: 'Disk Space',
      status: 'warning',
      message: 'Could not calculate disk usage',
    };
  }
};

export const checkMetadataIntegrity = async (
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<HealthCheckResult> => {
  const issues: string[] = [];

  // Check required fields
  if (!metadata.workspaceName) {
    issues.push('Missing workspace name');
  }

  if (!metadata.createdAt) {
    issues.push('Missing creation timestamp');
  }

  if (!metadata.repositories || metadata.repositories.length === 0) {
    issues.push('No repositories in metadata');
  }

  // Check for duplicate directory names
  const dirNames = metadata.repositories.map(r => r.directoryName);
  const uniqueDirNames = new Set(dirNames);
  if (dirNames.length !== uniqueDirNames.size) {
    issues.push('Duplicate directory names in metadata');
  }

  // Check for extra directories not in metadata
  try {
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory()).map(e => e.name);
    const metadataDirNames = new Set(dirNames);
    const extraDirs = directories.filter(
      dir => !metadataDirNames.has(dir) && !dir.startsWith('.')
    );

    if (extraDirs.length > 0) {
      issues.push(`${extraDirs.length} directories not tracked in metadata: ${extraDirs.join(', ')}`);
    }
  } catch (error) {
    // Ignore read errors
  }

  if (issues.length === 0) {
    return {
      category: 'Metadata Integrity',
      status: 'healthy',
      message: 'Metadata is valid',
    };
  }

  return {
    category: 'Metadata Integrity',
    status: 'warning',
    message: 'Metadata issues detected',
    details: issues.join('\n'),
    actionable: 'Review workspace metadata file',
  };
};

export const checkGhqInstalled = async (): Promise<HealthCheckResult> => {
  try {
    await execAsync('which ghq', { timeout: 5000 });
    return {
      category: 'ghq',
      status: 'healthy',
      message: 'ghq is installed (fast cached clones enabled)',
    };
  } catch {
    return {
      category: 'ghq',
      status: 'warning',
      message: 'ghq is not installed',
      details: 'Without ghq, repos are cloned directly with git — slower, no shared cache, and large repos can hit clone timeouts.',
      actionable: 'Install ghq: brew install ghq (macOS) — https://github.com/x-motemen/ghq#installation',
    };
  }
};

export const runAllHealthChecks = async (
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<HealthCheckResult[]> => {
  const repoNames = metadata.repositories.map(r => r.directoryName);

  const checks = await Promise.all([
    checkMissingRepositories(workspacePath, metadata),
    checkGitHealth(workspacePath, repoNames),
    checkUncommittedChanges(workspacePath, repoNames),
    checkAuthentication(),
    checkGhqInstalled(),
    checkDependencies(workspacePath, repoNames),
    checkDiskSpace(workspacePath),
    checkMetadataIntegrity(workspacePath, metadata),
  ]);

  return checks;
};

export const calculateHealthScore = (results: HealthCheckResult[]): number => {
  const weights = {
    healthy: 100,
    warning: 60,
    error: 0,
  };

  const totalWeight = results.reduce((sum, result) => sum + weights[result.status], 0);
  const maxWeight = results.length * 100;

  return Math.round((totalWeight / maxWeight) * 100);
};
