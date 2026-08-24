/**
 * Fuzzy repository name resolver.
 *
 * Resolves user-supplied repo name inputs (which may be partial, mis-spelled,
 * or differently-cased) to actual repository objects from the full list.
 *
 * Scoring ladder (higher = better match):
 *  100  exact case-sensitive match
 *   95  case-insensitive exact match
 *   90  normalised exact match (spaces/underscores → hyphens)
 *   80  input is a hyphen-boundary prefix of repo name  e.g. "platform" → "platform-app"
 *   75  repo name is a hyphen-boundary prefix of input
 *   65  input is a substring of repo name
 *   60  repo name is a substring of input
 *   30–50 Levenshtein edit distance ≤ threshold (typo tolerance)
 *
 * A match is only returned when score ≥ MIN_SCORE (30).
 */

/** Minimum score required to accept a fuzzy match. */
const MIN_SCORE = 30;

export interface FuzzyMatch<T> {
  repo: T;
  /** 0-100 confidence score. */
  score: number;
  /** True only for exact or case/normalisation-only matches (score ≥ 90). */
  exact: boolean;
}

/**
 * Normalise a repo name for comparison:
 *  - lowercase
 *  - spaces and underscores → hyphens
 *  - collapse repeated hyphens
 */
function normalise(s: string): string {
  return s
    .trim()                          // strip leading/trailing whitespace first
    .toLowerCase()
    .replace(/[\s_]+/g, '-')         // spaces and underscores → hyphens
    .replace(/-{2,}/g, '-')          // collapse repeated hyphens
    .replace(/^-+|-+$/g, '');        // strip any leading/trailing hyphens
}

/**
 * Compute the Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use two alternating rows to keep memory O(n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Damerau-Levenshtein distance (Optimal String Alignment variant).
 *
 * Like {@link levenshtein} but an ADJACENT TRANSPOSITION counts as a single
 * edit — so "capser" ↔ "casper" is distance 1, not 2. Transposing two
 * neighbouring characters is the most common human typo, so this is what we
 * use for typo-tolerant repo matching. Names are short, so the full O(mn)
 * matrix is negligible.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,        // deletion
        d[i][j - 1] + 1,        // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      // Adjacent transposition: a[i-1] a[i-2] == b[j-2] b[j-1]
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Score how well `originalInput` matches `originalRepo`.
 * All normalisation is done here so the scoring ladder is fully reachable.
 */
function scoreMatch(originalInput: string, originalRepo: string): number {
  // Exact (case-sensitive)
  if (originalRepo === originalInput) return 100;

  // Case-insensitive exact
  if (originalRepo.toLowerCase() === originalInput.toLowerCase()) return 95;

  // Normalised exact (spaces/underscores → hyphens; reachable for e.g. "my_app" or "my app")
  const normInput = normalise(originalInput);
  const normRepo = normalise(originalRepo);
  if (normRepo === normInput) return 90;

  // Prefix: normInput is a hyphen-boundary prefix of normRepo
  // e.g. "platform" → "platform-app"
  if (normRepo.startsWith(normInput + '-')) return 80;

  // Prefix: normRepo is a hyphen-boundary prefix of normInput
  if (normInput.startsWith(normRepo + '-')) return 75;

  // Substring: normInput appears inside normRepo
  if (normRepo.includes(normInput)) return 65;

  // Substring: normRepo appears inside normInput
  if (normInput.includes(normRepo)) return 60;

  // Token-level match: split by hyphens and see how many tokens overlap
  const inputTokens = normInput.split('-').filter(Boolean);
  const repoTokens = normRepo.split('-').filter(Boolean);
  if (inputTokens.length > 0 && repoTokens.length > 0) {
    let matched = 0;
    for (const it of inputTokens) {
      if (repoTokens.some(rt => rt === it || rt.startsWith(it) || it.startsWith(rt))) {
        matched++;
      }
    }
    if (matched > 0) {
      const tokenScore = Math.round(
        (matched / Math.max(inputTokens.length, repoTokens.length)) * 55,
      );
      if (tokenScore >= MIN_SCORE) return tokenScore;
    }
  }

  // Typo tolerance — Damerau-Levenshtein so an adjacent transposition
  // (e.g. "capser" → "casper") counts as a single edit.
  const dist = damerauLevenshtein(normInput, normRepo);
  // Allow more edits for longer names (up to 3, never more)
  const maxDist = Math.min(3, Math.floor(Math.max(normInput.length, normRepo.length) * 0.25));
  if (dist <= maxDist && maxDist > 0) {
    return Math.max(MIN_SCORE, 50 - dist * 10);
  }

  return 0;
}

/**
 * Find the best-matching repo from `allRepos` for a given user-supplied `input`.
 *
 * @param input    The repo name as typed/extracted (may be partial or mis-spelled).
 * @param allRepos Full list of available repositories (must have a `.name` string field).
 * @returns        The best match and its score, or `null` if no match is good enough.
 */
export function fuzzyFindRepo<T extends { name: string }>(
  input: string,
  allRepos: T[],
): FuzzyMatch<T> | null {
  if (!input || allRepos.length === 0) return null;
  // Inputs like "_", "-", or "   " normalise to ""; String#includes('') is
  // always true, so they would match every repo. Reject them early.
  if (!normalise(input)) return null;

  let best: FuzzyMatch<T> | null = null;

  for (const repo of allRepos) {
    const score = scoreMatch(input, repo.name);
    if (score > 0 && (!best || score > best.score)) {
      best = { repo, score, exact: score >= 90 };
    }
  }

  if (best && best.score >= MIN_SCORE) return best;
  return null;
}

/**
 * Resolve an array of user-supplied repo name inputs against the full repo list.
 *
 * Returns:
 *  - `resolved`: array of `{ input, repo, exact }` for each successfully matched name
 *  - `notFound`:  array of input strings that had no good match
 */
export function resolveRepoNames<T extends { name: string }>(
  inputs: string[],
  allRepos: T[],
): { resolved: Array<{ input: string; repo: T; exact: boolean }>; notFound: string[] } {
  const resolved: Array<{ input: string; repo: T; exact: boolean }> = [];
  const notFound: string[] = [];
  // Deduplicate: if two inputs fuzzy-resolve to the same repo, keep only the first.
  const seen = new Set<string>();

  for (const input of inputs) {
    const match = fuzzyFindRepo(input, allRepos);
    if (match) {
      if (!seen.has(match.repo.name)) {
        seen.add(match.repo.name);
        resolved.push({ input, repo: match.repo, exact: match.exact });
      }
      // else: duplicate resolution — silently skip (first wins)
    } else {
      notFound.push(input);
    }
  }

  return { resolved, notFound };
}

/** Suffix charset shared with the MCP update_workspace tool (name-suffix dir). */
export const VALID_SUFFIX = /^[a-zA-Z0-9_-]+$/;

export interface RepoSpec {
  /** Repo name to resolve (may be fuzzy). */
  name: string;
  /** Optional instance suffix — clones the same repo into `<repo>-<suffix>`. */
  suffix?: string;
}

/**
 * Parse a single `--repos` entry that may carry an instance suffix.
 *
 * The same repository can be added to a workspace more than once by giving
 * each copy a distinct suffix, e.g. a git-worktree-style second checkout:
 *
 *   "casper"            -> { name: "casper" }                  (dir: casper)
 *   "casper:cas-101"    -> { name: "casper", suffix: "cas-101"} (dir: casper-cas-101)
 *
 * This mirrors the MCP `update_workspace` tool's `{ name, suffix }` shape so
 * the CLI and agent paths behave identically.
 */
export function parseRepoSpec(spec: string): RepoSpec {
  const trimmed = spec.trim();
  const idx = trimmed.indexOf(':');
  if (idx > 0) {
    const name = trimmed.slice(0, idx).trim();
    const suffix = trimmed.slice(idx + 1).trim();
    return suffix ? { name, suffix } : { name };
  }
  return { name: trimmed };
}

/**
 * Resolve an array of `--repos` specs (each possibly `name:suffix`) into repo
 * entries with their target directory names. Unlike {@link resolveRepoNames},
 * this dedupes by the final **directory name**, so the same repo can appear
 * multiple times under different suffixes.
 */
export function resolveRepoSpecs<T extends { name: string }>(
  inputs: string[],
  allRepos: T[],
): {
  resolved: Array<{ input: string; repo: T; exact: boolean; suffix?: string; directoryName: string }>;
  notFound: string[];
  invalidSuffix: string[];
} {
  const resolved: Array<{ input: string; repo: T; exact: boolean; suffix?: string; directoryName: string }> = [];
  const notFound: string[] = [];
  const invalidSuffix: string[] = [];
  const seenDirs = new Set<string>();

  for (const input of inputs) {
    const spec = parseRepoSpec(input);
    if (spec.suffix !== undefined && !VALID_SUFFIX.test(spec.suffix)) {
      invalidSuffix.push(input);
      continue;
    }
    const match = fuzzyFindRepo(spec.name, allRepos);
    if (!match) {
      notFound.push(spec.name);
      continue;
    }
    const directoryName = spec.suffix ? `${match.repo.name}-${spec.suffix}` : match.repo.name;
    if (seenDirs.has(directoryName)) continue; // duplicate target dir within this batch
    seenDirs.add(directoryName);
    resolved.push({ input, repo: match.repo, exact: match.exact, suffix: spec.suffix, directoryName });
  }

  return { resolved, notFound, invalidSuffix };
}
