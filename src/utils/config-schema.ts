import { UserConfig, CONFIG_DEFAULTS } from './config';

/**
 * Declarative schema for the non-interactive `nemus config get/set` command.
 * Every writable UserConfig field is described here with its type + allowed
 * values, so `set` can validate/coerce a string argument and `get`/`list` can
 * enumerate keys. Kept as pure data + pure functions so it's fully unit-tested
 * without touching disk. Keep this in sync with the UserConfig interface — the
 * `satisfies` check below fails the build if a key is misspelled.
 */
export type ConfigKey = keyof UserConfig;

type FieldSpec =
  | { type: 'string'; allowEmpty?: boolean; describe: string }
  | { type: 'boolean'; describe: string }
  | { type: 'enum'; values: readonly string[]; describe: string };

const AGENT_VALUES = ['claude', 'pi', 'opencode', 'codex', 'gemini'] as const;

export const CONFIG_SCHEMA = {
  workspacesDir: { type: 'string', describe: 'Directory where workspaces are created' },
  githubOrg: { type: 'string', allowEmpty: true, describe: 'Default GitHub org for repo lookups' },
  cloneProtocol: { type: 'enum', values: ['ssh', 'https'], describe: 'Protocol used to clone repos' },
  aiAgent: {
    type: 'enum',
    values: [...AGENT_VALUES, 'both', 'auto'],
    describe: 'AI agent(s) to integrate with',
  },
  primaryAgent: {
    type: 'enum',
    values: [...AGENT_VALUES, 'auto'],
    describe: 'Agent launched when opening a workspace',
  },
  autoLaunchClaude: { type: 'boolean', describe: 'Auto-launch the agent after creating a workspace' },
  generateClaudeContext: { type: 'boolean', describe: 'Generate agent context files (AGENTS.md)' },
  installMcp: { type: 'boolean', describe: 'Install the MCP server during configure' },
  piWorkspaceInputStatus: { type: 'boolean', describe: "Show workspace status in Pi's input area" },
  claudeWorkspaceStatusLine: { type: 'boolean', describe: "Show workspace table in Claude's status line" },
  autoReportBugs: { type: 'boolean', describe: 'Auto-file a GitHub issue when a command crashes' },
} satisfies Record<ConfigKey, FieldSpec>;

export const CONFIG_KEYS = Object.keys(CONFIG_SCHEMA).sort() as ConfigKey[];

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on', 'y']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off', 'n']);

/** True if `key` is a writable config key. */
export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key);
}

export type ParseResult =
  | { ok: true; value: UserConfig[ConfigKey] }
  | { ok: false; error: string };

/** Validate + coerce a raw string for `key` into the field's typed value. */
export function parseConfigValue(key: ConfigKey, raw: string): ParseResult {
  const spec: FieldSpec = CONFIG_SCHEMA[key];
  if (spec.type === 'boolean') {
    const v = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(v)) return { ok: true, value: true };
    if (FALSE_WORDS.has(v)) return { ok: true, value: false };
    return { ok: false, error: `${key} expects a boolean (true/false); got "${raw}"` };
  }
  if (spec.type === 'enum') {
    // Enum values are all lowercase, so normalize input like booleans do —
    // `HTTPS` / ` https ` should resolve to the canonical value, not fail.
    const v = raw.trim().toLowerCase();
    if ((spec.values as readonly string[]).includes(v)) {
      return { ok: true, value: v as UserConfig[ConfigKey] };
    }
    return { ok: false, error: `${key} must be one of: ${spec.values.join(', ')}; got "${raw}"` };
  }
  // string: trim surrounding whitespace (a stray space in a path/org is almost
  // always a mistake), but preserve case.
  const trimmed = raw.trim();
  if (!spec.allowEmpty && trimmed === '') {
    return { ok: false, error: `${key} cannot be empty` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate an already-typed value (as it appears in the JSON config file) for
 * `key` against its field spec. This is the parse-free sibling of
 * parseConfigValue (which coerces a CLI string): it checks that a boolean field
 * holds a boolean, an enum holds an allowed string, and a string field holds a
 * (non-empty, unless allowEmpty) string. Used by `config edit` so a hand-edit
 * is validated the same way `config set` validates. Pure + unit-tested.
 */
export function validateTypedValue(key: ConfigKey, value: unknown): { ok: true } | { ok: false; error: string } {
  const spec: FieldSpec = CONFIG_SCHEMA[key];
  if (spec.type === 'boolean') {
    return typeof value === 'boolean' ? { ok: true } : { ok: false, error: `${key} must be a boolean` };
  }
  if (spec.type === 'enum') {
    return typeof value === 'string' && (spec.values as readonly string[]).includes(value)
      ? { ok: true }
      : { ok: false, error: `${key} must be one of: ${spec.values.join(', ')}` };
  }
  if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` };
  if (!spec.allowEmpty && value.trim() === '') return { ok: false, error: `${key} cannot be empty` };
  return { ok: true };
}

/** Apply a `set` to a config object, returning a NEW config or an error. Pure. */
export function applyConfigSet(
  current: UserConfig,
  key: string,
  raw: string,
): { ok: true; next: UserConfig; value: UserConfig[ConfigKey] } | { ok: false; error: string } {
  if (!isConfigKey(key)) {
    return { ok: false, error: `Unknown config key "${key}". Run "nemus config list" to see valid keys.` };
  }
  const parsed = parseConfigValue(key, raw);
  if (!parsed.ok) return parsed;
  return { ok: true, next: { ...current, [key]: parsed.value }, value: parsed.value };
}

/** Reset a key to its default value, returning a NEW config or an error. Pure. */
export function applyConfigUnset(
  current: UserConfig,
  key: string,
): { ok: true; next: UserConfig; value: UserConfig[ConfigKey] } | { ok: false; error: string } {
  if (!isConfigKey(key)) {
    return { ok: false, error: `Unknown config key "${key}". Run "nemus config list" to see valid keys.` };
  }
  const value = CONFIG_DEFAULTS[key];
  return { ok: true, next: { ...current, [key]: value }, value };
}

/** Render a config value for plain (scriptable) stdout output. */
export function formatConfigValue(value: unknown): string {
  return typeof value === 'boolean' ? String(value) : String(value ?? '');
}

export interface ConfigFileReview {
  /** JSON.parse failed. */
  parseError: boolean;
  /** Parsed, but not a plain object (null / array / scalar). */
  notObject: boolean;
  /** Keys present in the file that aren't recognized config keys. */
  unknownKeys: string[];
  /** Validation error messages for known keys holding invalid values. */
  invalid: string[];
  /** True when the file is a usable config object (may still have warnings). */
  ok: boolean;
}

/**
 * Review the raw text of a hand-edited config file the same way `config set`
 * validates: it must parse, be a plain object, only use known keys, and every
 * known key present must hold a schema-valid value. Pure so `config edit` can be
 * fully unit-tested without spawning an editor.
 */
export function reviewConfigFileText(text: string): ConfigFileReview {
  const base = { parseError: false, notObject: false, unknownKeys: [] as string[], invalid: [] as string[] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...base, parseError: true, ok: false };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, notObject: true, ok: false };
  }
  const obj = raw as Record<string, unknown>;
  const known = new Set<string>(CONFIG_KEYS);
  const unknownKeys = Object.keys(obj).filter((k) => !known.has(k));
  const invalid: string[] = [];
  for (const key of CONFIG_KEYS) {
    if (!(key in obj)) continue;
    const res = validateTypedValue(key, obj[key]);
    if (!res.ok) invalid.push(res.error);
  }
  return { parseError: false, notObject: false, unknownKeys, invalid, ok: invalid.length === 0 };
}
