import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GitHubRepo, WorkspaceMetadata } from '../types';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT = 15000;

/** Committable manifest that fully describes a workspace's repos + branch state. */
export const LOCK_FILENAME = 'nemus.lock';
export const LOCK_VERSION = 1;

export interface LockRepo {
  name: string;
  owner: string;
  directoryName: string;
  cloneUrl: string;
  /** Current branch at lock time. Omitted for a detached HEAD. */
  branch?: string;
  /** Short HEAD SHA at lock time (used by `restore --pin`, and as a fallback). */
  commit?: string;
}

export interface WorkspaceLock {
  version: number;
  workspace: string;
  generatedAt: string;
  repositories: LockRepo[];
}

/** Read the current branch of a git repo, or undefined for a detached HEAD / error. */
export async function readRepoBranch(repoPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  } catch {
    return undefined;
  }
}

/** Read the short HEAD SHA of a git repo, or undefined on error. */
export async function readRepoCommit(repoPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoPath,
      timeout: GIT_TIMEOUT,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a lock manifest from a workspace's metadata, reading the live branch +
 * commit for each successfully-cloned repo directory.
 */
export async function buildLock(
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<WorkspaceLock> {
  const repos = metadata.repositories.filter(r => r.status !== 'failed');

  const repositories: LockRepo[] = await Promise.all(
    repos.map(async (r): Promise<LockRepo> => {
      const repoPath = path.join(workspacePath, r.directoryName);
      const [branch, commit] = await Promise.all([
        readRepoBranch(repoPath),
        readRepoCommit(repoPath),
      ]);
      return {
        name: r.name,
        owner: r.owner,
        directoryName: r.directoryName,
        cloneUrl: r.cloneUrl,
        ...(branch ? { branch } : {}),
        ...(commit ? { commit } : {}),
      };
    })
  );

  return {
    version: LOCK_VERSION,
    workspace: metadata.workspaceName,
    generatedAt: new Date().toISOString(),
    repositories,
  };
}

/** Serialize a lock to canonical JSON (trailing newline). */
export function serializeLock(lock: WorkspaceLock): string {
  return JSON.stringify(lock, null, 2) + '\n';
}

export async function writeLock(filePath: string, lock: WorkspaceLock): Promise<void> {
  await fs.writeFile(filePath, serializeLock(lock), 'utf-8');
}

/** Parse + validate a lock manifest. Throws a helpful error on malformed input. */
export function parseLock(content: string): WorkspaceLock {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Not valid JSON — is this a nemus.lock file?');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Lockfile is not an object');
  }
  const lock = data as Partial<WorkspaceLock>;
  if (lock.version !== LOCK_VERSION) {
    throw new Error(
      `Unsupported lockfile version ${String(lock.version)} (this nemus supports version ${LOCK_VERSION})`
    );
  }
  if (typeof lock.workspace !== 'string' || !lock.workspace) {
    throw new Error('Lockfile is missing a "workspace" name');
  }
  if (!Array.isArray(lock.repositories)) {
    throw new Error('Lockfile is missing a "repositories" array');
  }
  for (const [i, r] of lock.repositories.entries()) {
    if (!r || typeof r !== 'object') throw new Error(`repositories[${i}] is not an object`);
    const entry = r as Partial<LockRepo>;
    for (const field of ['name', 'owner', 'directoryName', 'cloneUrl'] as const) {
      if (typeof entry[field] !== 'string' || !entry[field]) {
        throw new Error(`repositories[${i}] is missing "${field}"`);
      }
    }
  }
  return lock as WorkspaceLock;
}

export async function readLockFile(filePath: string): Promise<WorkspaceLock> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseLock(content);
}

/**
 * Extract the git host from a clone URL — supports scp-style
 * (`git@github.com:owner/repo.git`) and URL-style
 * (`https://github.com/owner/repo.git`, `ssh://git@host/owner/repo`).
 * Returns undefined if it can't be determined.
 */
export function parseGitHost(cloneUrl: string): string | undefined {
  const scp = cloneUrl.match(/^[^@/]+@([^:/]+):/);
  if (scp) return scp[1];
  try {
    const u = new URL(cloneUrl);
    if (u.hostname) return u.hostname;
  } catch {
    // not a URL
  }
  return undefined;
}

/**
 * Rebuild a `GitHubRepo` for cloning from a lock entry. When the host is known
 * we synthesize both https + ssh forms for `<host>/<owner>/<name>` so
 * `getCloneUrl` can honor the restorer's `cloneProtocol`; otherwise we fall back
 * to the stored `cloneUrl` for both fields (clone from exactly what was locked).
 */
export function reconstructRepo(entry: LockRepo): GitHubRepo {
  const host = parseGitHost(entry.cloneUrl);
  const url = host ? `https://${host}/${entry.owner}/${entry.name}` : entry.cloneUrl;
  const sshUrl = host ? `git@${host}:${entry.owner}/${entry.name}.git` : entry.cloneUrl;
  return {
    name: entry.name,
    url,
    sshUrl,
    owner: { login: entry.owner },
    description: '',
    isPrivate: false,
  };
}
