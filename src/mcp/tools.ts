import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import fuzzy from 'fuzzy';
import { resolveRepoNames } from '../utils/repo-resolver';
import { WORKSPACES_DIR, getCloneUrl } from '../utils/config';
import { formatContextFile, appendToContextFile } from '../utils/context-file';
import { listWorkspaces, loadMetadata, createMetadata, saveMetadata, archiveWorkspace, unarchiveWorkspace } from '../utils/workspace-meta';
import { getAllReposStatus } from '../utils/git-status';
import { getRepoDiff, RepoDiff } from '../utils/diff-operations';
import { syncRepository, SyncResult } from '../utils/sync-operations';
import { runInRepo, RunResult } from '../utils/run-operations';
import { listSuites, getSuite, saveSuite, deleteSuite, exportSuite, exportAllSuites, importSuites, validateSuiteName } from '../utils/suite';
import { fetchOrgRepos } from '../utils/github';
import { cloneRepositories, reportCloneResults } from '../utils/git-operations';
import { generateClaudeContext } from '../utils/claude-integration';
import { runAllHealthChecks, calculateHealthScore } from '../utils/health-checks';
import { analyzeDependencies, detectCircularDependencies } from '../utils/dependency-analyzer';
import { createBranch, switchBranch, mergeBranch, rebaseBranch } from '../utils/branch-operations';
import { removeNodeModules, removeBuildArtifacts } from '../utils/cleanup-operations';
import { runPostCloneHooks } from '../utils/hooks';
import { SuiteEntry, WorkspaceSuite, SuitesStore } from '../types';
import { resolveWorkspaceNameConflict, sanitizeWorkspaceName } from '../utils/validation';

/**
 * Redirects stdout to stderr for the duration of a function call.
 * MCP uses stdout exclusively for JSON-RPC, so any console.log from
 * utility functions (logInfo, logSuccess, etc.) would corrupt the protocol.
 */
async function withStdoutProtection<T>(fn: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write;
  process.stdout.write = process.stderr.write.bind(process.stderr);
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

export async function handleListWorkspaces(includeArchived: boolean = false) {
  return withStdoutProtection(async () => {
    const workspaces = await listWorkspaces(includeArchived);
    return workspaces.map(ws => ({
      name: ws.name,
      path: ws.path,
      repoCount: ws.metadata?.repositories.filter(r => r.status === 'success').length ?? 0,
      createdAt: ws.metadata?.createdAt ?? null,
      archivedAt: ws.metadata?.archivedAt ?? null,
    }));
  });
}

export async function handleArchiveWorkspace(workspace: string) {
  return withStdoutProtection(async () => {
    await archiveWorkspace(workspace);
    return {
      workspace,
      status: 'archived',
      message: `Workspace "${workspace}" has been archived. It will be auto-deleted in 30 days.`,
    };
  });
}

export async function handleUnarchiveWorkspace(workspace: string) {
  return withStdoutProtection(async () => {
    await unarchiveWorkspace(workspace);
    return {
      workspace,
      status: 'active',
      message: `Workspace "${workspace}" has been unarchived and is now active.`,
    };
  });
}

export async function handleWorkspaceStatus(workspace: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const repoNames = repos.map(r => r.directoryName);
    const statuses = await getAllReposStatus(workspacePath, repoNames);

    return {
      workspace,
      repos: statuses,
    };
  });
}

export async function handleWorkspaceDiff(workspace: string, full: boolean = false) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const diffs: RepoDiff[] = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const diff = await getRepoDiff(repoPath, repo.directoryName);
      diffs.push(diff);
    }

    const totalStaged = diffs.reduce((sum, d) => sum + d.staged.files, 0);
    const totalUnstaged = diffs.reduce((sum, d) => sum + d.unstaged.files, 0);
    const reposWithChanges = diffs.filter(d => d.staged.files > 0 || d.unstaged.files > 0).length;

    return {
      workspace,
      diffs,
      summary: { totalStaged, totalUnstaged, reposWithChanges },
    };
  });
}

export async function handleWorkspaceSync(workspace: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results: SyncResult[] = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await syncRepository(repoPath, repo.directoryName, true);
      results.push(result);
    }

    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    return {
      workspace,
      results,
      summary: { successful, failed, skipped },
    };
  });
}

export async function handleRunCommand(workspace: string, command: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results: RunResult[] = [];
    const concurrency = 3;

    for (let i = 0; i < repos.length; i += concurrency) {
      const chunk = repos.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(repo => {
          const repoPath = path.join(workspacePath, repo.directoryName);
          return runInRepo(repoPath, repo.directoryName, command);
        })
      );
      results.push(...chunkResults);
    }

    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return {
      workspace,
      command,
      results,
      summary: { successful, failed },
    };
  });
}

export async function handleListSuites() {
  return withStdoutProtection(async () => {
    const suites = await listSuites();
    return suites.map(s => ({
      name: s.name,
      description: s.description,
      repoCount: s.entries.length,
      hasHooks: (s.postCloneHooks?.length ?? 0) > 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  });
}

export async function handleWorkspaceInfo(workspace: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    return {
      ...metadata,
      path: workspacePath,
    };
  });
}

export async function handleUpdateWorkspace(workspace: string, repos: Array<string | { name: string; suffix: string }>) {
  return withStdoutProtection(async () => {
    if (!workspace || workspace.trim().length === 0) {
      throw new Error('Workspace name is required');
    }
    if (!repos || repos.length === 0) {
      throw new Error('At least one repository name is required');
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const existingDirectoryNames = metadata.repositories.map(r => r.directoryName);

    // Fetch all repos to resolve names to full repo objects
    const allRepos = await fetchOrgRepos();
    const repoEntries: Array<{ repo: typeof allRepos[0]; directoryName: string }> = [];
    const notFound: string[] = [];
    const alreadyExists: string[] = [];
    const fuzzyMatched: Array<{ requested: string; resolved: string }> = [];

    for (const repoInput of repos) {
      const repoName = typeof repoInput === 'string' ? repoInput : repoInput.name;
      const suffix = typeof repoInput === 'string' ? undefined : repoInput.suffix;

      const { resolved, notFound: missing } = resolveRepoNames([repoName], allRepos);
      if (missing.length > 0) {
        notFound.push(repoName);
        continue;
      }
      const found = resolved[0].repo;
      if (!resolved[0].exact) {
        fuzzyMatched.push({ requested: repoName, resolved: found.name });
      }

      if (suffix && !/^[a-zA-Z0-9_-]+$/.test(suffix)) {
        throw new Error(`Invalid suffix "${suffix}" for repo "${repoName}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
      }

      const directoryName = suffix ? `${found.name}-${suffix}` : found.name;

      if (existingDirectoryNames.includes(directoryName)) {
        alreadyExists.push(suffix ? `${repoName} (as ${directoryName})` : repoName);
        continue;
      }

      existingDirectoryNames.push(directoryName);
      repoEntries.push({ repo: found, directoryName });
    }

    if (repoEntries.length === 0) {
      const reasons: string[] = [];
      if (notFound.length > 0) reasons.push(`not found: ${notFound.join(', ')}`);
      if (alreadyExists.length > 0) reasons.push(`already in workspace: ${alreadyExists.join(', ')}`);
      throw new Error(`No new repos to add (${reasons.join('; ')})`);
    }

    // Clone new repositories
    const cloneResults = await cloneRepositories(repoEntries, workspacePath);

    // Update metadata
    const newRepoMetadata = cloneResults.map(result => ({
      name: result.repo.name,
      directoryName: result.directoryName,
      owner: result.repo.owner.login,
      clonedAt: result.clonedAt || new Date().toISOString(),
      cloneUrl: getCloneUrl(result.repo),
      status: result.status as 'success' | 'failed',
      error: result.error,
    }));

    metadata.repositories.push(...newRepoMetadata);
    await saveMetadata(workspacePath, metadata);

    const successful = cloneResults.filter(r => r.status === 'success');
    const failed = cloneResults.filter(r => r.status === 'failed');

    return {
      workspace,
      path: workspacePath,
      added: cloneResults.map(r => ({
        name: r.repo.name,
        directoryName: r.directoryName,
        status: r.status,
        error: r.error,
      })),
      summary: {
        successful: successful.length,
        failed: failed.length,
        totalRepos: metadata.repositories.filter(r => r.status === 'success').length,
      },
      alreadyExists: alreadyExists.length > 0 ? alreadyExists : undefined,
      notFound: notFound.length > 0 ? notFound : undefined,
      fuzzyMatched: fuzzyMatched.length > 0 ? fuzzyMatched : undefined,
    };
  });
}

export async function handleUpdateCache() {
  return withStdoutProtection(async () => {
    const repos = await fetchOrgRepos({ forceRefresh: true });
    return {
      repos: repos.length,
      message: `Cache updated with ${repos.length} repositories`,
    };
  });
}

export async function handleCreateWorkspace(workspace: string, repos: string[]) {
  return withStdoutProtection(async () => {
    if (!workspace || workspace.trim().length === 0) {
      throw new Error('Workspace name is required');
    }
    if (!repos || repos.length === 0) {
      throw new Error('At least one repository name is required');
    }

    const sanitizedWorkspace = sanitizeWorkspaceName(workspace);
    const workspacePath = path.join(WORKSPACES_DIR, sanitizedWorkspace);

    // Auto-resolve workspace name conflict instead of throwing
    let finalWorkspaceName = sanitizedWorkspace;
    let wsExists = false;
    try {
      await fs.access(workspacePath);
      wsExists = true;
    } catch {
      // Directory doesn't exist — good, use the original name
    }
    if (wsExists) {
      // Workspace already exists — resolve to a unique name using repo names as hints
      // (errors from resolveWorkspaceNameConflict intentionally propagate)
      finalWorkspaceName = await resolveWorkspaceNameConflict(sanitizedWorkspace, repos);
    }

    // Fetch all repos to resolve names to full repo objects
    const allRepos = await fetchOrgRepos();
    const repoEntries: Array<{ repo: typeof allRepos[0]; directoryName: string }> = [];
    const notFound: string[] = [];

    const { resolved, notFound: missing } = resolveRepoNames(repos, allRepos);
    notFound.push(...missing);
    const fuzzyMatched: Array<{ requested: string; resolved: string }> = [];
    for (const r of resolved) {
      repoEntries.push({ repo: r.repo, directoryName: r.repo.name });
      if (!r.exact) fuzzyMatched.push({ requested: r.input, resolved: r.repo.name });
    }

    if (repoEntries.length === 0) {
      throw new Error(`None of the specified repos were found: ${notFound.join(', ')}`);
    }

    // Create workspace directory
    const finalWorkspacePath = path.join(WORKSPACES_DIR, finalWorkspaceName);
    await fs.mkdir(finalWorkspacePath, { recursive: true });

    // Clone repositories
    const cloneResults = await cloneRepositories(repoEntries, finalWorkspacePath);

    // Save metadata
    const metadata = createMetadata(finalWorkspaceName, cloneResults);
    await saveMetadata(finalWorkspacePath, metadata);

    // Generate Claude context
    const successfulRepos = cloneResults
      .filter(r => r.status === 'success')
      .map(r => r.repo);

    if (successfulRepos.length > 0) {
      await generateClaudeContext(finalWorkspacePath, finalWorkspaceName, successfulRepos, metadata);
    }

    const successful = cloneResults.filter(r => r.status === 'success');
    const failed = cloneResults.filter(r => r.status === 'failed');

    // Write workspace path to temp file so shell integration can cd to it
    if (successful.length > 0) {
      const tempFile = path.join(os.homedir(), '.workspace-last-created');
      await fs.writeFile(tempFile, finalWorkspacePath, 'utf-8').catch(() => {});
    }

    return {
      workspace: finalWorkspaceName,
      originalWorkspaceName: finalWorkspaceName !== sanitizedWorkspace ? sanitizedWorkspace : undefined,
      path: finalWorkspacePath,
      repos: cloneResults.map(r => ({
        name: r.repo.name,
        directoryName: r.directoryName,
        status: r.status,
        error: r.error,
      })),
      summary: {
        successful: successful.length,
        failed: failed.length,
      },
      notFound: notFound.length > 0 ? notFound : undefined,
      fuzzyMatched: fuzzyMatched.length > 0 ? fuzzyMatched : undefined,
    };
  });
}

export async function handleSearchRepos(query: string, limit: number = 20) {
  return withStdoutProtection(async () => {
    const allRepos = await fetchOrgRepos();
    const results = fuzzy.filter(query, allRepos, {
      extract: (repo: typeof allRepos[0]) => `${repo.name} ${repo.description || ''}`,
    });

    return results.slice(0, limit).map(r => ({
      name: r.original.name,
      description: r.original.description,
      url: r.original.url,
      isPrivate: r.original.isPrivate,
      score: r.score,
    }));
  });
}

export async function handleListOrgRepos(forceRefresh: boolean = false) {
  return withStdoutProtection(async () => {
    const repos = await fetchOrgRepos({ forceRefresh });
    return {
      repos: repos.map(r => ({
        name: r.name,
        description: r.description,
        url: r.url,
        isPrivate: r.isPrivate,
      })),
      total: repos.length,
    };
  });
}

export async function handleDeleteWorkspace(workspaces: string | string[]) {
  return withStdoutProtection(async () => {
    const names = Array.isArray(workspaces) ? workspaces : [workspaces];
    const results: Array<{ workspace: string; path: string; deleted: boolean; error?: string }> = [];

    for (const workspace of names) {
      const workspacePath = path.join(WORKSPACES_DIR, workspace);

      try {
        await fs.access(workspacePath);
      } catch {
        results.push({ workspace, path: workspacePath, deleted: false, error: `Workspace directory not found: ${workspace}` });
        continue;
      }

      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
        results.push({ workspace, path: workspacePath, deleted: true });
      } catch (err) {
        results.push({ workspace, path: workspacePath, deleted: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    if (names.length === 1) {
      const r = results[0];
      if (!r.deleted) throw new Error(r.error!);
      return { deleted: r.workspace, path: r.path };
    }

    return { results };
  });
}

export async function handleRemoveRepo(workspace: string, repo: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repoIndex = metadata.repositories.findIndex(r => r.directoryName === repo);
    if (repoIndex === -1) {
      throw new Error(`Repository not found in workspace: ${repo}`);
    }

    const repoPath = path.join(workspacePath, repo);
    await fs.rm(repoPath, { recursive: true, force: true });

    metadata.repositories.splice(repoIndex, 1);
    await saveMetadata(workspacePath, metadata);

    const successfulRepos = metadata.repositories
      .filter(r => r.status === 'success');

    // Best-effort regeneration of Claude context
    try {
      if (successfulRepos.length > 0) {
        const allRepos = await fetchOrgRepos();
        const repoObjects = successfulRepos
          .map(r => allRepos.find(ar => ar.name === r.name))
          .filter((r): r is NonNullable<typeof r> => r != null);

        if (repoObjects.length > 0) {
          await generateClaudeContext(workspacePath, workspace, repoObjects, metadata);
        }
      }
    } catch {
      // Claude context regeneration is non-critical
    }

    return {
      removed: repo,
      workspace,
      remainingRepos: successfulRepos.length,
    };
  });
}

export async function handleWorkspaceDoctor(workspace: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const results = await runAllHealthChecks(workspacePath, metadata);
    const score = calculateHealthScore(results);

    return {
      workspace,
      score,
      checks: results,
    };
  });
}

export async function handleAnalyzeDeps(workspace: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const repoNames = repos.map(r => r.directoryName);

    const analyses = await analyzeDependencies(workspacePath, repoNames);
    const circularDeps = detectCircularDependencies(analyses);

    // Convert Map to plain object for JSON serialization
    const analysesObj: Record<string, {
      repoName: string;
      dependencies: string[];
      dependents: string[];
      missingDependencies: string[];
    }> = {};
    for (const [key, value] of analyses) {
      analysesObj[key] = value;
    }

    return {
      workspace,
      analyses: analysesObj,
      circularDependencies: circularDeps,
    };
  });
}

export async function handleBranchCreate(workspace: string, branchName: string, baseBranch?: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await createBranch(repoPath, repo.directoryName, branchName, baseBranch);
      results.push(result);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      workspace,
      branchName,
      baseBranch: baseBranch || 'current',
      results,
      summary: { successful, failed },
    };
  });
}

export async function handleSwitchBranch(workspace: string, branch: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await switchBranch(repoPath, repo.directoryName, branch);
      results.push(result);
    }

    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    return {
      workspace,
      branch,
      results,
      summary: { successful, failed, skipped },
    };
  });
}

export async function handleWorkspaceCleanup(
  workspace: string,
  includeNodeModules: boolean = true,
  includeBuildArtifacts: boolean = true
) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results: Array<{
      repo: string;
      nodeModules?: import('../utils/cleanup-operations').CleanupResult;
      buildArtifacts?: import('../utils/cleanup-operations').CleanupResult;
    }> = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const repoResult: typeof results[0] = { repo: repo.directoryName };

      if (includeNodeModules) {
        repoResult.nodeModules = await removeNodeModules(repoPath);
      }
      if (includeBuildArtifacts) {
        repoResult.buildArtifacts = await removeBuildArtifacts(repoPath);
      }

      results.push(repoResult);
    }

    // Calculate total space freed
    let totalFreedMB = 0;
    for (const r of results) {
      if (r.nodeModules) {
        totalFreedMB += parseFloat(r.nodeModules.spaceFreed) || 0;
      }
      if (r.buildArtifacts) {
        totalFreedMB += parseFloat(r.buildArtifacts.spaceFreed) || 0;
      }
    }

    return {
      workspace,
      results,
      totalSpaceFreed: `${totalFreedMB.toFixed(2)} MB`,
    };
  });
}

// --- Branch merge/rebase ---

export async function handleBranchMerge(
  workspace: string,
  sourceBranch: string,
  targetBranch: string,
  strategy?: 'no-ff' | 'ff-only' | 'squash'
) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results = [];

    const options = strategy ? {
      noFf: strategy === 'no-ff',
      ffOnly: strategy === 'ff-only',
      squash: strategy === 'squash',
    } : undefined;

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await mergeBranch(repoPath, repo.directoryName, sourceBranch, targetBranch, options);
      results.push(result);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      workspace,
      sourceBranch,
      targetBranch,
      strategy: strategy || 'default',
      results,
      summary: { successful, failed },
    };
  });
}

export async function handleBranchRebase(workspace: string, targetBranch: string) {
  return withStdoutProtection(async () => {
    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const repos = metadata.repositories.filter(r => r.status === 'success');
    const results = [];

    for (const repo of repos) {
      const repoPath = path.join(workspacePath, repo.directoryName);
      const result = await rebaseBranch(repoPath, repo.directoryName, targetBranch);
      results.push(result);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      workspace,
      targetBranch,
      results,
      summary: { successful, failed },
    };
  });
}

// --- Suite operations ---

export async function handleSuiteCreate(name: string, repos: string[], description?: string) {
  return withStdoutProtection(async () => {
    const validation = validateSuiteName(name);
    if (validation !== true) {
      throw new Error(`Invalid suite name: ${validation}`);
    }

    if (!repos || repos.length === 0) {
      throw new Error('At least one repository name is required');
    }

    const existing = await getSuite(name);
    if (existing) {
      throw new Error(`Suite already exists: ${name}. Delete it first or use a different name.`);
    }

    const entries: SuiteEntry[] = repos.map(repoName => ({
      repoName,
      directoryName: repoName,
    }));

    const suite: WorkspaceSuite = {
      name,
      description: description || '',
      entries,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveSuite(suite);

    return {
      name: suite.name,
      description: suite.description,
      repoCount: entries.length,
      repos: repos,
    };
  });
}

export async function handleSuiteDelete(name: string) {
  return withStdoutProtection(async () => {
    const deleted = await deleteSuite(name);
    if (!deleted) {
      throw new Error(`Suite not found: ${name}`);
    }
    return { deleted: name };
  });
}

export async function handleSuiteExport(name?: string) {
  return withStdoutProtection(async () => {
    if (name) {
      const result = await exportSuite(name);
      if (!result) {
        throw new Error(`Suite not found: ${name}`);
      }
      return result;
    }
    return await exportAllSuites();
  });
}

export async function handleSuiteImport(content: string, overwrite: boolean = false) {
  return withStdoutProtection(async () => {
    let parsed: SuitesStore;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid JSON content');
    }

    if (!parsed.suites || !Array.isArray(parsed.suites)) {
      throw new Error('Invalid suites format: expected { version: 1, suites: [...] }');
    }

    const result = await importSuites(parsed, overwrite);
    return result;
  });
}

export async function handleSuiteUse(suiteName: string, workspace: string) {
  return withStdoutProtection(async () => {
    const suite = await getSuite(suiteName);
    if (!suite) {
      throw new Error(`Suite not found: ${suiteName}`);
    }

    const sanitizedSuiteWorkspace = sanitizeWorkspaceName(workspace);
    const workspacePath = path.join(WORKSPACES_DIR, sanitizedSuiteWorkspace);

    // Auto-resolve workspace name conflict using suite repo names as hints
    let finalSuiteWorkspaceName = sanitizedSuiteWorkspace;
    let suiteWsExists = false;
    try {
      await fs.access(workspacePath);
      suiteWsExists = true;
    } catch {
      // Directory doesn't exist — good
    }
    if (suiteWsExists) {
      // Workspace already exists — resolve to a unique name
      // (errors from resolveWorkspaceNameConflict intentionally propagate)
      const suiteRepoNames = suite.entries.map(e => e.repoName);
      finalSuiteWorkspaceName = await resolveWorkspaceNameConflict(sanitizedSuiteWorkspace, suiteRepoNames);
    }

    // Resolve suite entries to GitHub repos
    const allRepos = await fetchOrgRepos();
    const repoEntries: Array<{ repo: typeof allRepos[0]; directoryName: string }> = [];
    const notFound: string[] = [];

    for (const entry of suite.entries) {
      const found = allRepos.find(r => r.name.toLowerCase() === entry.repoName.toLowerCase());
      if (found) {
        repoEntries.push({ repo: found, directoryName: entry.directoryName });
      } else {
        notFound.push(entry.repoName);
      }
    }

    if (repoEntries.length === 0) {
      throw new Error(`None of the suite repos were found: ${notFound.join(', ')}`);
    }

    // Create workspace directory
    const finalSuiteWorkspacePath = path.join(WORKSPACES_DIR, finalSuiteWorkspaceName);
    await fs.mkdir(finalSuiteWorkspacePath, { recursive: true });

    // Clone repositories
    const cloneResults = await cloneRepositories(repoEntries, finalSuiteWorkspacePath);

    // Save metadata
    const metadata = createMetadata(finalSuiteWorkspaceName, cloneResults);
    await saveMetadata(finalSuiteWorkspacePath, metadata);

    // Generate Claude context
    const successfulRepos = cloneResults
      .filter(r => r.status === 'success')
      .map(r => r.repo);

    if (successfulRepos.length > 0) {
      await generateClaudeContext(finalSuiteWorkspacePath, finalSuiteWorkspaceName, successfulRepos, metadata);
    }

    // Run post-clone hooks if suite has them
    if (suite.postCloneHooks && suite.postCloneHooks.length > 0) {
      try {
        const repoMetadata = metadata.repositories.filter(r => r.status === 'success');
        await runPostCloneHooks(finalSuiteWorkspacePath, repoMetadata, suite.postCloneHooks);
      } catch {
        // Post-clone hooks are non-critical
      }
    }

    const successful = cloneResults.filter(r => r.status === 'success');
    const failed = cloneResults.filter(r => r.status === 'failed');

    return {
      workspace: finalSuiteWorkspaceName,
      originalWorkspaceName: finalSuiteWorkspaceName !== sanitizedSuiteWorkspace ? sanitizedSuiteWorkspace : undefined,
      suite: suiteName,
      path: finalSuiteWorkspacePath,
      repos: cloneResults.map(r => ({
        name: r.repo.name,
        directoryName: r.directoryName,
        status: r.status,
        error: r.error,
      })),
      summary: { successful: successful.length, failed: failed.length },
      notFound: notFound.length > 0 ? notFound : undefined,
    };
  });
}


export async function handleSaveContext(workspace: string, content: string, append?: boolean) {
  return withStdoutProtection(async () => {
    if (!workspace || workspace.trim().length === 0) {
      throw new Error('Workspace name is required');
    }
    if (!content || content.trim().length === 0) {
      throw new Error('Content is required');
    }

    const workspacePath = path.join(WORKSPACES_DIR, workspace);
    const metadata = await loadMetadata(workspacePath);
    if (!metadata) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const contextPath = path.join(workspacePath, 'CONTEXT.md');
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');

    let fileContent: string;
    if (append) {
      let existing: string | null = null;
      try {
        existing = await fs.readFile(contextPath, 'utf-8');
      } catch {
        // File doesn't exist yet
      }
      fileContent = appendToContextFile(existing, workspace, content, timestamp);
    } else {
      fileContent = formatContextFile(workspace, content, timestamp);
    }

    await fs.writeFile(contextPath, fileContent, 'utf-8');

    return {
      saved: true,
      path: contextPath,
      workspace,
      append: append ?? false,
      timestamp,
    };
  });
}
