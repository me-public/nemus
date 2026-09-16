import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  parseLock,
  serializeLock,
  parseGitHost,
  reconstructRepo,
  buildLock,
  isSafeSegment,
  isAllowedCloneUrl,
  isSafeGitRef,
  LOCK_VERSION,
  type WorkspaceLock,
  type LockRepo,
} from './workspace-lock';
import type { WorkspaceMetadata } from '../types';

const execFileAsync = promisify(execFile);

const validLock: WorkspaceLock = {
  version: LOCK_VERSION,
  workspace: 'checkout-flow',
  generatedAt: '2026-09-09T10:00:00.000Z',
  repositories: [
    { name: 'web', owner: 'acme', directoryName: 'web', cloneUrl: 'git@github.com:acme/web.git', branch: 'feat/x', commit: 'abc1234' },
  ],
};

describe('parseLock', () => {
  it('round-trips a valid lock through serialize + parse', () => {
    const parsed = parseLock(serializeLock(validLock));
    expect(parsed).toEqual(validLock);
  });

  it('rejects non-JSON', () => {
    expect(() => parseLock('not json')).toThrow(/valid JSON/i);
  });

  it('rejects an unsupported version', () => {
    const bad = JSON.stringify({ ...validLock, version: 99 });
    expect(() => parseLock(bad)).toThrow(/version 99/);
  });

  it('rejects a missing workspace name', () => {
    const bad = JSON.stringify({ ...validLock, workspace: '' });
    expect(() => parseLock(bad)).toThrow(/workspace/i);
  });

  it('rejects a non-array repositories field', () => {
    const bad = JSON.stringify({ ...validLock, repositories: {} });
    expect(() => parseLock(bad)).toThrow(/repositories/i);
  });

  it('rejects a repo entry missing a required field', () => {
    const bad = JSON.stringify({ ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName: 'web' }] });
    expect(() => parseLock(bad)).toThrow(/cloneUrl/);
  });

  it('accepts entries without optional branch/commit', () => {
    const minimal = { ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName: 'web', cloneUrl: 'https://github.com/acme/web.git' }] };
    expect(() => parseLock(JSON.stringify(minimal))).not.toThrow();
  });

  // Untrusted-input hardening: fields that reach git / path.join are validated.
  it('rejects a directoryName that escapes the workspace', () => {
    for (const directoryName of ['../evil', 'a/b', '..', 'a\\b']) {
      const bad = { ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName, cloneUrl: 'https://h/o/r.git' }] };
      expect(() => parseLock(JSON.stringify(bad)), directoryName).toThrow(/path segment/);
    }
  });

  it('rejects an owner/name that is not a safe path segment (reconstructRepo builds URLs from them)', () => {
    const badOwner = { ...validLock, repositories: [{ name: 'web', owner: '../x', directoryName: 'web', cloneUrl: 'https://h/o/r.git' }] };
    expect(() => parseLock(JSON.stringify(badOwner))).toThrow(/owner/);
    const badName = { ...validLock, repositories: [{ name: 'a/b', owner: 'acme', directoryName: 'web', cloneUrl: 'https://h/o/r.git' }] };
    expect(() => parseLock(JSON.stringify(badName))).toThrow(/name/);
  });

  it('rejects a cloneUrl with no recognized transport (option-injection)', () => {
    for (const cloneUrl of ['--upload-pack=/x', '-oProxyCommand=x', '/local/path.git', 'file:///x']) {
      const bad = { ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName: 'web', cloneUrl }] };
      expect(() => parseLock(JSON.stringify(bad)), cloneUrl).toThrow(/transport/);
    }
  });

  it('rejects a branch/commit that could smuggle git flags', () => {
    const badBranch = { ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName: 'web', cloneUrl: 'https://h/o/r.git', branch: '--upload-pack=x' }] };
    expect(() => parseLock(JSON.stringify(badBranch))).toThrow(/branch/);
    const badCommit = { ...validLock, repositories: [{ name: 'web', owner: 'acme', directoryName: 'web', cloneUrl: 'https://h/o/r.git', commit: '-x' }] };
    expect(() => parseLock(JSON.stringify(badCommit))).toThrow(/commit/);
  });
});

describe('field validators', () => {
  it('isSafeSegment accepts plain names, rejects traversal/separators', () => {
    for (const ok of ['web', 'my-repo', 'repo.git', 'a..b']) expect(isSafeSegment(ok), ok).toBe(true);
    for (const no of ['', '.', '..', 'a/b', 'a\\b', '../x']) expect(isSafeSegment(no), no).toBe(false);
  });
  it('isAllowedCloneUrl accepts real remotes, rejects options/paths', () => {
    for (const ok of ['https://github.com/a/b.git', 'ssh://git@h/a/b', 'git@github.com:a/b.git', 'git://h/a/b']) expect(isAllowedCloneUrl(ok), ok).toBe(true);
    for (const no of ['--upload-pack=x', '/local/path', 'file:///x', 'ext::sh -c x']) expect(isAllowedCloneUrl(no), no).toBe(false);
  });
  it('isSafeGitRef accepts real refs, rejects flags/metachars', () => {
    for (const ok of ['main', 'feat/x', 'release-1.2', 'abc1234']) expect(isSafeGitRef(ok), ok).toBe(true);
    for (const no of ['-x', '--flag', 'a b', 'a..b', 'a~1', 'a^', 'a:b', '']) expect(isSafeGitRef(no), no).toBe(false);
  });
});

describe('parseGitHost', () => {
  it('parses scp-style URLs', () => {
    expect(parseGitHost('git@github.com:acme/web.git')).toBe('github.com');
    expect(parseGitHost('git@gitlab.example.com:team/app.git')).toBe('gitlab.example.com');
  });
  it('parses URL-style remotes', () => {
    expect(parseGitHost('https://github.com/acme/web.git')).toBe('github.com');
    expect(parseGitHost('ssh://git@code.corp/team/app')).toBe('code.corp');
  });
  it('returns undefined for garbage', () => {
    expect(parseGitHost('not-a-url')).toBeUndefined();
  });
});

describe('reconstructRepo', () => {
  it('synthesizes https + ssh forms for a known host so getCloneUrl can pick', () => {
    const repo = reconstructRepo({ name: 'web', owner: 'acme', directoryName: 'web', cloneUrl: 'git@github.com:acme/web.git' });
    expect(repo.url).toBe('https://github.com/acme/web');
    expect(repo.sshUrl).toBe('git@github.com:acme/web.git');
    expect(repo.owner.login).toBe('acme');
  });

  it('preserves a non-default host from the locked URL', () => {
    const repo = reconstructRepo({ name: 'app', owner: 'team', directoryName: 'app', cloneUrl: 'git@gitlab.corp:team/app.git' });
    expect(repo.url).toBe('https://gitlab.corp/team/app');
    expect(repo.sshUrl).toBe('git@gitlab.corp:team/app.git');
  });

  it('falls back to the stored URL when the host is unparseable', () => {
    const url = './local/path.git';
    const repo = reconstructRepo({ name: 'x', owner: 'y', directoryName: 'x', cloneUrl: url });
    expect(repo.url).toBe(url);
    expect(repo.sshUrl).toBe(url);
  });
});

describe('buildLock', () => {
  let tmp: string;
  let repoDir: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nemus-lock-'));
    repoDir = path.join(tmp, 'web');
    await fs.mkdir(repoDir, { recursive: true });
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir });
    await git(['init', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await git(['checkout', '-q', '-b', 'feat/x']);
    await fs.writeFile(path.join(repoDir, 'f.txt'), 'hi');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('captures the live branch + commit for each repo', async () => {
    const metadata: WorkspaceMetadata = {
      workspaceName: 'demo',
      createdAt: 'now',
      repositories: [
        { name: 'web', directoryName: 'web', owner: 'acme', clonedAt: 'now', cloneUrl: 'git@github.com:acme/web.git', status: 'success' },
      ],
    };
    const lock = await buildLock(tmp, metadata);
    expect(lock.version).toBe(LOCK_VERSION);
    expect(lock.workspace).toBe('demo');
    expect(lock.repositories).toHaveLength(1);
    const [r] = lock.repositories;
    expect(r.branch).toBe('feat/x');
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('skips repos whose clone failed', async () => {
    const metadata: WorkspaceMetadata = {
      workspaceName: 'demo',
      createdAt: 'now',
      repositories: [
        { name: 'web', directoryName: 'web', owner: 'acme', clonedAt: 'now', cloneUrl: 'x', status: 'success' },
        { name: 'gone', directoryName: 'gone', owner: 'acme', clonedAt: 'now', cloneUrl: 'x', status: 'failed', error: 'nope' },
      ],
    };
    const lock = await buildLock(tmp, metadata);
    expect(lock.repositories.map((r: LockRepo) => r.name)).toEqual(['web']);
  });
});
