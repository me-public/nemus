// Pure logic for `nemus prune` — deciding which workspaces are stale and which
// are unsafe to delete. Kept free of I/O so it can be unit-tested exhaustively;
// the command layer (src/commands/prune.ts) does the filesystem/git work and
// feeds the results in here.
import type { GitStatus } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WorkspaceForPrune {
  name: string;
  path: string;
  /** Repo directory names inside the workspace (for the git safety check). */
  repoDirNames: string[];
  /** Epoch ms of the most recent agent session, or 0 if none. */
  lastActiveAt: number;
  /** Epoch ms parsed from metadata.createdAt, or 0 if absent/unparseable. */
  createdAt: number;
}

export interface PruneCandidate {
  name: string;
  path: string;
  repoDirNames: string[];
  /** The timestamp staleness is measured from (lastActive, else createdAt). */
  referenceAt: number;
  /** Whether the reference came from a real session (vs. createdAt fallback). */
  fromSession: boolean;
  /** Whole days since referenceAt (floored). */
  ageDays: number;
  /** True when we have no date at all to judge age. */
  undatable: boolean;
}

export interface ProtectedWorkspace {
  candidate: PruneCandidate;
  reason: string;
}

export interface PrunePlan {
  /** Stale + safe to delete. */
  prunable: PruneCandidate[];
  /** Stale but held back (uncommitted/unpushed work), unless includeDirty. */
  protected: ProtectedWorkspace[];
}

/** Build a dated candidate for a workspace. `now` is injected for testability. */
export function toCandidate(ws: WorkspaceForPrune, now: number): PruneCandidate {
  const referenceAt = ws.lastActiveAt > 0 ? ws.lastActiveAt : ws.createdAt;
  const undatable = !(referenceAt > 0);
  const ageDays = undatable ? 0 : Math.floor((now - referenceAt) / MS_PER_DAY);
  return {
    name: ws.name,
    path: ws.path,
    repoDirNames: ws.repoDirNames,
    referenceAt,
    fromSession: ws.lastActiveAt > 0,
    ageDays,
    undatable,
  };
}

/**
 * A workspace is a prune candidate when it is datable and its age meets the
 * threshold. Undatable workspaces are never auto-selected — we won't delete
 * something we can't put a date on. A future `referenceAt` (clock skew) yields
 * a negative age and is therefore not stale.
 */
export function isStale(c: PruneCandidate, days: number): boolean {
  return !c.undatable && c.ageDays >= days;
}

/**
 * Why a stale workspace should be held back from deletion, or null if it's safe.
 * Unsafe = any repo has uncommitted changes (`!clean`) or unpushed commits
 * (`ahead > 0`). With `includeDirty`, nothing is held back. An empty workspace
 * (no repos) is always safe.
 */
export function protectionReason(statuses: GitStatus[], includeDirty: boolean): string | null {
  if (includeDirty) return null;
  const dirty = statuses.filter((s) => !s.clean).length;
  const unpushed = statuses.filter((s) => s.ahead > 0).length;
  if (dirty === 0 && unpushed === 0) return null;
  const parts: string[] = [];
  if (dirty > 0) parts.push(`${dirty} repo${dirty === 1 ? '' : 's'} with uncommitted changes`);
  if (unpushed > 0) parts.push(`${unpushed} repo${unpushed === 1 ? '' : 's'} with unpushed commits`);
  return parts.join(', ');
}

/**
 * Partition stale candidates into prunable vs. protected, given a resolver that
 * returns each workspace's per-repo git status. The resolver is only invoked
 * for workspaces that actually have repos, so empty stale workspaces cost no git
 * calls. Injecting the resolver keeps this function pure and unit-testable.
 */
export async function planPrune(
  staleCandidates: PruneCandidate[],
  getStatuses: (c: PruneCandidate) => Promise<GitStatus[]>,
  includeDirty: boolean,
): Promise<PrunePlan> {
  const prunable: PruneCandidate[] = [];
  const protectedList: ProtectedWorkspace[] = [];
  for (const c of staleCandidates) {
    const statuses = c.repoDirNames.length > 0 ? await getStatuses(c) : [];
    const reason = protectionReason(statuses, includeDirty);
    if (reason) protectedList.push({ candidate: c, reason });
    else prunable.push(c);
  }
  return { prunable, protected: protectedList };
}
