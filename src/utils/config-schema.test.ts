import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS, UserConfig } from './config';
import {
  CONFIG_KEYS,
  CONFIG_SCHEMA,
  isConfigKey,
  parseConfigValue,
  applyConfigSet,
  applyConfigUnset,
  formatConfigValue,
} from './config-schema';

describe('config schema coverage', () => {
  it('describes every UserConfig key exactly once', () => {
    expect(CONFIG_KEYS.slice().sort()).toEqual(Object.keys(CONFIG_DEFAULTS).sort());
  });
  it('is sorted for stable listing', () => {
    expect(CONFIG_KEYS).toEqual(CONFIG_KEYS.slice().sort());
  });
});

describe('isConfigKey', () => {
  it('accepts known keys, rejects unknown / prototype keys', () => {
    expect(isConfigKey('githubOrg')).toBe(true);
    expect(isConfigKey('nope')).toBe(false);
    expect(isConfigKey('toString')).toBe(false); // not an own property
    expect(isConfigKey('')).toBe(false);
  });
});

describe('parseConfigValue', () => {
  it('coerces booleans from common words (case-insensitive)', () => {
    for (const t of ['true', '1', 'YES', 'on', 'y']) {
      expect(parseConfigValue('autoReportBugs', t)).toEqual({ ok: true, value: true });
    }
    for (const f of ['false', '0', 'No', 'off', 'n']) {
      expect(parseConfigValue('autoReportBugs', f)).toEqual({ ok: true, value: false });
    }
  });
  it('rejects non-boolean words with a helpful error', () => {
    const r = parseConfigValue('installMcp', 'maybe');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/boolean/);
  });
  it('validates enums', () => {
    expect(parseConfigValue('cloneProtocol', 'https')).toEqual({ ok: true, value: 'https' });
    const r = parseConfigValue('cloneProtocol', 'ftp');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ssh, https/);
  });
  it('accepts agent enum values incl. auto/both', () => {
    expect(parseConfigValue('aiAgent', 'both').ok).toBe(true);
    expect(parseConfigValue('primaryAgent', 'both').ok).toBe(false); // no "both" for primary
    expect(parseConfigValue('primaryAgent', 'pi').ok).toBe(true);
  });
  it('rejects empty required strings but allows empty githubOrg', () => {
    expect(parseConfigValue('workspacesDir', '').ok).toBe(false);
    expect(parseConfigValue('githubOrg', '')).toEqual({ ok: true, value: '' });
  });
});

describe('applyConfigSet / applyConfigUnset (pure, immutable)', () => {
  const base: UserConfig = { ...CONFIG_DEFAULTS, githubOrg: 'acme' };

  it('returns a new object and does not mutate the input', () => {
    const r = applyConfigSet(base, 'githubOrg', 'octocat');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next.githubOrg).toBe('octocat');
      expect(r.value).toBe('octocat');
    }
    expect(base.githubOrg).toBe('acme'); // unchanged
  });

  it('rejects unknown keys', () => {
    const r = applyConfigSet(base, 'bogus', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown config key/);
  });

  it('unset resets to the default value', () => {
    const r = applyConfigUnset(base, 'githubOrg');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.githubOrg).toBe(CONFIG_DEFAULTS.githubOrg);
  });
});

describe('formatConfigValue', () => {
  it('renders booleans and empty strings predictably', () => {
    expect(formatConfigValue(true)).toBe('true');
    expect(formatConfigValue(false)).toBe('false');
    expect(formatConfigValue('')).toBe('');
    expect(formatConfigValue('ssh')).toBe('ssh');
  });
});

describe('CONFIG_SCHEMA describe text', () => {
  it('every key has a non-empty description', () => {
    for (const k of CONFIG_KEYS) expect(CONFIG_SCHEMA[k].describe.length).toBeGreaterThan(0);
  });
});
