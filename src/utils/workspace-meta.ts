import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceMetadata, RepositoryMetadata, CloneResult } from '../types';
import { logSuccess, logWarning, logError } from './logger';
import { WORKSPACES_DIR, META_FILENAME, getCloneUrl } from './config';
import { safeWorkspacePath } from './validation';

const ARCHIVE_EXPIRY_DAYS = 30;

export const createMetadata = (
  workspaceName: string,
  cloneResults: CloneResult[],
  options?: { prompt?: string }
): WorkspaceMetadata => {
  const repositories: RepositoryMetadata[] = cloneResults.map(result => ({
    name: result.repo.name,
    directoryName: result.directoryName,
    owner: result.repo.owner.login,
    clonedAt: result.clonedAt || new Date().toISOString(),
    cloneUrl: getCloneUrl(result.repo),
    status: result.status,
    error: result.error,
  }));

  return {
    workspaceName,
    createdAt: new Date().toISOString(),
    repositories,
    ...(options?.prompt ? { prompt: options.prompt } : {}),
  };
};

export const saveMetadata = async (
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<void> => {
  try {
    const metaPath = path.join(workspacePath, META_FILENAME);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    logSuccess('Saved workspace metadata');
  } catch (error) {
    logWarning('Failed to save workspace metadata');
    if (error instanceof Error) {
      logError(error.message);
    }
  }
};

export const loadMetadata = async (workspacePath: string): Promise<WorkspaceMetadata | null> => {
  try {
    const metaPath = path.join(workspacePath, META_FILENAME);
    const content = await fs.readFile(metaPath, 'utf-8');
    const metadata: WorkspaceMetadata = JSON.parse(content);

    // Backward compatibility: default directoryName to name for old entries
    for (const repo of metadata.repositories) {
      if (!repo.directoryName) {
        repo.directoryName = repo.name;
      }
    }

    return metadata;
  } catch {
    return null;
  }
};

export const listWorkspaces = async (
  includeArchived: boolean = false
): Promise<Array<{ name: string; path: string; metadata: WorkspaceMetadata | null }>> => {
  try {
    await fs.access(WORKSPACES_DIR);
  } catch {
    return [];
  }

  try {
    // Lazily purge expired archives on every list call
    await purgeExpiredArchives();

    const entries = await fs.readdir(WORKSPACES_DIR, { withFileTypes: true });
    const workspaces = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspacePath = path.join(WORKSPACES_DIR, entry.name);
        const metadata = await loadMetadata(workspacePath);

        // Filter based on archive status
        if (!includeArchived && metadata?.archivedAt) {
          continue;
        }

        workspaces.push({
          name: entry.name,
          path: workspacePath,
          metadata,
        });
      }
    }

    return workspaces;
  } catch (error) {
    logError('Failed to list workspaces');
    return [];
  }
};

export const archiveWorkspace = async (workspaceName: string): Promise<void> => {
  const workspacePath = safeWorkspacePath(workspaceName);
  const metadata = await loadMetadata(workspacePath);

  if (!metadata) {
    throw new Error(`Workspace not found: ${workspaceName}`);
  }

  if (metadata.archivedAt) {
    throw new Error(`Workspace is already archived: ${workspaceName}`);
  }

  metadata.archivedAt = new Date().toISOString();
  await saveMetadata(workspacePath, metadata);
};

export const unarchiveWorkspace = async (workspaceName: string): Promise<void> => {
  const workspacePath = safeWorkspacePath(workspaceName);
  const metadata = await loadMetadata(workspacePath);

  if (!metadata) {
    throw new Error(`Workspace not found: ${workspaceName}`);
  }

  if (!metadata.archivedAt) {
    throw new Error(`Workspace is not archived: ${workspaceName}`);
  }

  delete metadata.archivedAt;
  await saveMetadata(workspacePath, metadata);
};

export const purgeExpiredArchives = async (): Promise<void> => {
  try {
    await fs.access(WORKSPACES_DIR);
  } catch {
    return;
  }

  try {
    const entries = await fs.readdir(WORKSPACES_DIR, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workspacePath = path.join(WORKSPACES_DIR, entry.name);
      const metadata = await loadMetadata(workspacePath);

      if (!metadata?.archivedAt) continue;

      const archivedTime = new Date(metadata.archivedAt).getTime();
      const daysSinceArchive = (now - archivedTime) / (1000 * 60 * 60 * 24);

      if (daysSinceArchive > ARCHIVE_EXPIRY_DAYS) {
        await fs.rm(workspacePath, { recursive: true, force: true });
        process.stderr.write(`Purged expired archive: ${entry.name}\n`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Error purging expired archives: ${error.message}\n`);
    }
  }
};
