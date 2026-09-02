import { describe, it, expect } from 'vitest';
import {
  toCandidate,
  isStale,
  protectionReason,
  planPrune,
  type WorkspaceForPrune,
  type PruneCandidate,
} from './prune';
import type { GitStatus } from '../types';

const NOW = Date.parse('2026-09-01T00:00:00Z');
const daysAgo = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

function ws(over: Partial<WorkspaceForPrune> = {}): WorkspaceForPrune {
  return { name: 'w', path: '/w', repoDirNames: [], lastActiveAt: 0, createdAt: 0, ...over };
}
function status(over: Partial<GitStatus> = {}): GitStatus {
  return {
    repo: 'r', branch: 'main', clean: true, ahead: 0, behind: 0,
    modifiedFiles: 0, untrackedFiles: 0, hasRemote: true, detachedHead: false, ...over,
  };
}

describe('toCandidate', () => {
  it('prefers lastActive over createdAt and marks fromSession', () => {
    const c = toCandidate(ws({ lastActiveAt: daysAgo(5), createdAt: daysAgo(40) }), NOW);
    expect(c.fromSession).toBe(true);
    expect(c.ageDays).toBe(5);
    expect(c.undatable).toBe(false);
  });

  it('falls back to createdAt when there is no session', () => {
    const c = toCandidate(ws({ lastActiveAt: 0, createdAt: daysAgo(40) }), NOW);
    expect(c.fromSession).toBe(false);
    expect(c.ageDays).toBe(40);
  });

  it('is undatable when neither timestamp is present', () => {
    const c = toCandidate(ws({ lastActiveAt: 0, createdAt: 0 }), NOW);
    expect(c.undatable).toBe(true);
    expect(c.ageDays).toBe(0);
  });

  it('floors a future reference to a negative age (clock skew) without marking undatable', () => {
    const c = toCandidate(ws({ lastActiveAt: NOW + 60_000 }), NOW);
    expect(c.undatable).toBe(false);
    expect(c.ageDays).toBeLessThan(0);
  });
});

describe('isStale', () => {
  const c = (over: Partial<WorkspaceForPrune>) => toCandidate(ws(over), NOW);

  it('is true at or beyond the threshold', () => {
    expect(isStale(c({ lastActiveAt: daysAgo(30) }), 30)).toBe(true);
    expect(isStale(c({ lastActiveAt: daysAgo(31) }), 30)).toBe(true);
  });
  it('is false below the threshold', () => {
    expect(isStale(c({ lastActiveAt: daysAgo(29) }), 30)).toBe(false);
  });
  it('never selects an undatable workspace', () => {
    expect(isStale(c({ lastActiveAt: 0, createdAt: 0 }), 0)).toBe(false);
  });
  it('never selects a future-dated (skewed) workspace', () => {
    expect(isStale(c({ lastActiveAt: NOW + 86_400_000 }), 0)).toBe(false);
  });
});

describe('protectionReason', () => {
  it('returns null for an all-clean workspace', () => {
    expect(protectionReason([status(), status()], false)).toBeNull();
  });
  it('returns null for an empty workspace', () => {
    expect(protectionReason([], false)).toBeNull();
  });
  it('flags uncommitted changes', () => {
    expect(protectionReason([status({ clean: false })], false)).toBe('1 repo with uncommitted changes');
  });
  it('flags unpushed commits', () => {
    expect(protectionReason([status({ ahead: 2 })], false)).toBe('1 repo with unpushed commits');
  });
  it('combines both reasons and pluralizes', () => {
    expect(
      protectionReason([status({ clean: false }), status({ clean: false }), status({ ahead: 1 })], false),
    ).toBe('2 repos with uncommitted changes, 1 repo with unpushed commits');
  });
  it('returns null when includeDirty overrides protection', () => {
    expect(protectionReason([status({ clean: false, ahead: 3 })], true)).toBeNull();
  });
});

describe('planPrune', () => {
  const mk = (name: string, repos: string[]): PruneCandidate =>
    toCandidate(ws({ name, path: `/w/${name}`, repoDirNames: repos, lastActiveAt: daysAgo(40) }), NOW);

  it('partitions prunable vs protected and skips git calls for empty workspaces', async () => {
    const empty = mk('empty', []);
    const clean = mk('clean', ['a']);
    const dirty = mk('dirty', ['b']);
    let calls = 0;
    const resolver = async (c: PruneCandidate): Promise<GitStatus[]> => {
      calls++;
      return c.name === 'dirty' ? [status({ clean: false })] : [status()];
    };

    const plan = await planPrune([empty, clean, dirty], resolver, false);

    expect(plan.prunable.map((c) => c.name)).toEqual(['empty', 'clean']);
    expect(plan.protected.map((p) => p.candidate.name)).toEqual(['dirty']);
    expect(plan.protected[0].reason).toBe('1 repo with uncommitted changes');
    expect(calls).toBe(2); // empty workspace incurred no status call
  });

  it('includeDirty moves everything to prunable', async () => {
    const dirty = mk('dirty', ['b']);
    const plan = await planPrune([dirty], async () => [status({ clean: false, ahead: 2 })], true);
    expect(plan.prunable.map((c) => c.name)).toEqual(['dirty']);
    expect(plan.protected).toHaveLength(0);
  });
});
