import { describe, it, expect } from 'vitest';
import { fuzzyFindRepo, resolveRepoNames, levenshtein, damerauLevenshtein, parseRepoSpec, resolveRepoSpecs } from './repo-resolver';

const repos = [
  { name: 'acme-app' },
  { name: 'partnerships-api' },
  { name: 'platform-app' },
  { name: 'acme-db' },
  { name: 'payments-service' },
  { name: 'analytics-service' },
  { name: 'notifications-service' },
  { name: 'nemus' },
  { name: 'casper' },
];

// ── levenshtein ───────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('returns length of string when other is empty', () => {
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('counts single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('counts single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('counts single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });
});

// ── damerauLevenshtein ──────────────────────────────────────────

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('casper', 'casper')).toBe(0);
  });

  it('counts an adjacent transposition as a single edit', () => {
    expect(damerauLevenshtein('capser', 'casper')).toBe(1); // plain levenshtein = 2
    expect(damerauLevenshtein('casepr', 'casper')).toBe(1);
  });

  it('still counts substitution / insertion / deletion as 1', () => {
    expect(damerauLevenshtein('cat', 'bat')).toBe(1);
    expect(damerauLevenshtein('cat', 'cats')).toBe(1);
    expect(damerauLevenshtein('cats', 'cat')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
  });
});

// ── fuzzyFindRepo ─────────────────────────────────────────────────────────────

describe('fuzzyFindRepo', () => {
  describe('exact matches', () => {
    it('finds an exact case-sensitive match (score 100)', () => {
      const result = fuzzyFindRepo('acme-app', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
      expect(result!.score).toBe(100);
      expect(result!.exact).toBe(true);
    });

    it('finds case-insensitive exact match (score 95)', () => {
      const result = fuzzyFindRepo('Acme-App', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
      expect(result!.score).toBe(95);
      expect(result!.exact).toBe(true);
    });

    it('strips leading/trailing whitespace without creating stray hyphens', () => {
      const result = fuzzyFindRepo(' acme-app ', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
      expect(result!.score).toBe(90); // normalised match (trim removes the spaces)
      expect(result!.exact).toBe(true);
    });

    it('normalises underscores to hyphens (score 90)', () => {
      const result = fuzzyFindRepo('acme_app', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
      expect(result!.score).toBe(90);
      expect(result!.exact).toBe(true);
    });

    it('normalises spaces to hyphens (score 90)', () => {
      const result = fuzzyFindRepo('acme app', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
      expect(result!.score).toBe(90);
      expect(result!.exact).toBe(true);
    });
  });

  describe('prefix matches', () => {
    it('matches input as prefix of repo name — "partnerships" → "partnerships-api"', () => {
      const result = fuzzyFindRepo('partnerships', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('partnerships-api');
      expect(result!.score).toBe(80);
      expect(result!.exact).toBe(false);
    });

    it('matches input as prefix — "platform" → "platform-app"', () => {
      const result = fuzzyFindRepo('platform', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('platform-app');
    });

    it('matches input as prefix — "payments" → "payments-service"', () => {
      const result = fuzzyFindRepo('payments', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('payments-service');
    });
  });

  describe('substring matches', () => {
    it('matches input as substring — "analytics" → "analytics-service"', () => {
      const result = fuzzyFindRepo('analytics', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('analytics-service');
    });

    it('matches "-service" repos via partial name — "notifications" → "notifications-service"', () => {
      const result = fuzzyFindRepo('notifications', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('notifications-service');
    });
  });

  describe('typo / Levenshtein tolerance', () => {
    it('tolerates a single typo — "acme-aps" → "acme-app"', () => {
      const result = fuzzyFindRepo('acme-aps', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-app');
    });

    it('tolerates a single typo — "platfrom-app" → "platform-app"', () => {
      const result = fuzzyFindRepo('platfrom-app', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('platform-app');
    });

    it('tolerates an adjacent transposition on a short name — "capser" → "casper"', () => {
      // Regression: plain Levenshtein scores this typo as distance 2, which
      // exceeded maxDist=1 for a 6-char name. Damerau counts the swap as 1.
      const result = fuzzyFindRepo('capser', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('casper');
    });

    it('tolerates a trailing transposition — "casepr" → "casper"', () => {
      const result = fuzzyFindRepo('casepr', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('casper');
    });

    it('tolerates a missing character — "acme-b" → "acme-db" (prefix wins)', () => {
      const result = fuzzyFindRepo('acme-d', repos);
      expect(result).not.toBeNull();
      expect(result!.repo.name).toBe('acme-db');
    });
  });

  describe('no match', () => {
    it('returns null for completely unrelated input', () => {
      const result = fuzzyFindRepo('xyzzy-totally-unrelated', repos);
      expect(result).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(fuzzyFindRepo('', repos)).toBeNull();
    });

    it('returns null for whitespace-only input (normalises to empty string)', () => {
      expect(fuzzyFindRepo('   ', repos)).toBeNull();
    });

    it('returns null for underscore-only input (normalises to empty string)', () => {
      expect(fuzzyFindRepo('_', repos)).toBeNull();
    });

    it('returns null for hyphen-only input (normalises to empty string)', () => {
      expect(fuzzyFindRepo('-', repos)).toBeNull();
    });

    it('returns null for empty repo list', () => {
      expect(fuzzyFindRepo('acme-app', [])).toBeNull();
    });
  });
});

// ── resolveRepoNames ──────────────────────────────────────────────────────────

describe('resolveRepoNames', () => {
  it('resolves a mix of exact and fuzzy matches', () => {
    const { resolved, notFound } = resolveRepoNames(
      ['acme-app', 'partnerships', 'platfrom-app'],
      repos,
    );
    expect(resolved.map(r => r.repo.name)).toEqual([
      'acme-app',
      'partnerships-api',
      'platform-app',
    ]);
    expect(notFound).toEqual([]);
  });

  it('puts unresolvable names in notFound', () => {
    const { resolved, notFound } = resolveRepoNames(
      ['acme-app', 'xyzzy-nope'],
      repos,
    );
    expect(resolved).toHaveLength(1);
    expect(notFound).toEqual(['xyzzy-nope']);
  });

  it('marks fuzzy (non-exact) matches correctly', () => {
    const { resolved } = resolveRepoNames(['partnerships'], repos);
    expect(resolved[0].exact).toBe(false);
    expect(resolved[0].input).toBe('partnerships');
    expect(resolved[0].repo.name).toBe('partnerships-api');
  });

  it('marks exact matches correctly', () => {
    const { resolved } = resolveRepoNames(['acme-app'], repos);
    expect(resolved[0].exact).toBe(true);
  });

  it('deduplicates when two inputs resolve to the same repo', () => {
    // 'partnerships' and 'partnerships-api' both fuzzy-resolve to 'partnerships-api'
    const { resolved, notFound } = resolveRepoNames(
      ['partnerships', 'partnerships-api'],
      repos,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].repo.name).toBe('partnerships-api');
    expect(notFound).toEqual([]);
  });

  it('returns empty resolved and all inputs in notFound when no repos match', () => {
    const { resolved, notFound } = resolveRepoNames(['abc', 'xyz'], repos);
    expect(resolved).toHaveLength(0);
    expect(notFound).toEqual(['abc', 'xyz']);
  });
});

// ── parseRepoSpec / resolveRepoSpecs (instance suffixes) ────────────────────────

describe('parseRepoSpec', () => {
  it('parses a bare repo name', () => {
    expect(parseRepoSpec('casper')).toEqual({ name: 'casper' });
  });
  it('parses name:suffix into name + suffix', () => {
    expect(parseRepoSpec('casper:cas-101')).toEqual({ name: 'casper', suffix: 'cas-101' });
  });
  it('trims whitespace around name and suffix', () => {
    expect(parseRepoSpec('  casper : cas-101 ')).toEqual({ name: 'casper', suffix: 'cas-101' });
  });
  it('treats an empty suffix as no suffix', () => {
    expect(parseRepoSpec('casper:')).toEqual({ name: 'casper' });
  });
});

describe('resolveRepoSpecs', () => {
  it('adds the same repo twice under distinct suffixes', () => {
    const { resolved, notFound, invalidSuffix } = resolveRepoSpecs(
      ['platform-app', 'platform-app:hotfix'],
      repos,
    );
    expect(notFound).toEqual([]);
    expect(invalidSuffix).toEqual([]);
    expect(resolved.map(r => r.directoryName)).toEqual(['platform-app', 'platform-app-hotfix']);
  });

  it('appends the suffix to the RESOLVED (fuzzy) repo name', () => {
    const { resolved } = resolveRepoSpecs(['platfrom-app:cas-101'], repos);
    expect(resolved[0].repo.name).toBe('platform-app');
    expect(resolved[0].directoryName).toBe('platform-app-cas-101');
    expect(resolved[0].exact).toBe(false);
  });

  it('dedupes identical target directories within a batch', () => {
    const { resolved } = resolveRepoSpecs(['acme-db', 'acme-db'], repos);
    expect(resolved).toHaveLength(1);
  });

  it('flags invalid suffixes', () => {
    const { invalidSuffix, resolved } = resolveRepoSpecs(['acme-db:bad/slash'], repos);
    expect(invalidSuffix).toEqual(['acme-db:bad/slash']);
    expect(resolved).toEqual([]);
  });

  it('reports unmatched repo names', () => {
    const { notFound } = resolveRepoSpecs(['totally-not-a-repo'], repos);
    expect(notFound).toEqual(['totally-not-a-repo']);
  });
});
