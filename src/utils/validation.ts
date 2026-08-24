import * as fs from 'fs/promises';
import { WORKSPACES_DIR } from './config';
import * as path from 'path';

const WORKSPACE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Allowlist for a single, safe path segment used as a workspace (or suite) name.
 * Alphanumerics plus hyphen/underscore only — it cannot express a path
 * separator, a Windows drive, a leading `~`, or a `.`/`..` traversal component,
 * so a value that matches this can never escape its parent directory.
 */
export const isSafePathSegment = (name: unknown): name is string =>
  typeof name === 'string' && name.length > 0 && name.length <= 64 && WORKSPACE_NAME_REGEX.test(name);

/**
 * Throw unless `name` is a safe workspace-name path segment. Use this in any
 * handler that receives a workspace/suite name from an untrusted caller (e.g.
 * the MCP server, whose Zod schemas otherwise accept any string) BEFORE the
 * name is used to build a filesystem path.
 */
export const assertSafeWorkspaceName = (name: unknown, label = 'workspace name'): void => {
  if (!isSafePathSegment(name)) {
    throw new Error(
      `Invalid ${label} "${String(name)}": only letters, numbers, hyphens, and underscores are allowed ` +
      `(no path separators, "..", or other special characters).`,
    );
  }
};

/**
 * Validate a workspace name and resolve it to an absolute path guaranteed to sit
 * directly inside WORKSPACES_DIR. This is the single choke point every code path
 * (especially the MCP handlers) must use instead of a raw
 * `path.join(WORKSPACES_DIR, name)` — it closes the path-traversal vector where
 * a caller could pass e.g. "../../etc" as a workspace name to read, write,
 * delete, or run commands outside the workspaces sandbox.
 *
 * Two independent guards: the allowlist above (which cannot express traversal)
 * and a resolved-path containment check (belt-and-suspenders, also catches any
 * future change that loosens the allowlist).
 */
export const safeWorkspacePath = (name: string): string => {
  assertSafeWorkspaceName(name);
  const base = path.resolve(WORKSPACES_DIR);
  const resolved = path.resolve(base, name);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Refusing to use a workspace path outside the workspaces directory: "${name}"`);
  }
  return resolved;
};

export const validateWorkspaceName = (name: string): boolean | string => {
  if (!name || name.trim().length === 0) {
    return 'Workspace name cannot be empty';
  }

  if (!WORKSPACE_NAME_REGEX.test(name)) {
    return 'Workspace name must contain only alphanumeric characters, hyphens, and underscores (spaces are automatically converted to hyphens)';
  }

  if (name.length < 3) {
    return 'Workspace name must be at least 3 characters long';
  }

  if (name.length > 50) {
    return 'Workspace name must be less than 50 characters';
  }

  return true;
};

export const checkWorkspaceExists = async (name: string): Promise<boolean> => {
  const workspacePath = path.join(WORKSPACES_DIR, name);
  try {
    await fs.access(workspacePath);
    return true;
  } catch {
    return false;
  }
};

export const sanitizeWorkspaceName = (name: string): string => {
  return name.trim().toLowerCase().replace(/ +/g, '-');
};

/**
 * Resolves a workspace name conflict by generating a unique alternative name.
 *
 * Strategy:
 *   1. Try appending each provided candidate suffix (e.g. repo names): `<name>-<candidate>`
 *   2. Fall back to numeric suffixes: `<name>-2`, `<name>-3`, …
 *
 * @param baseName   - The sanitized workspace name that already exists.
 * @param candidates - Optional list of preferred suffixes to try first (e.g. selected repo names).
 * @returns A workspace name that does not yet exist on disk and passes validation.
 */
export const resolveWorkspaceNameConflict = async (
  baseName: string,
  candidates: string[] = []
): Promise<string> => {
  // 1. Try candidate-based suffixes (e.g. repo names)
  for (const candidate of candidates) {
    const suffix = sanitizeWorkspaceName(candidate)
      .replace(/[^a-z0-9_-]/g, '-')  // extra safety — strip any bad chars after sanitise
      .replace(/-+/g, '-')            // collapse consecutive hyphens
      .replace(/^-|-$/g, '');         // trim leading/trailing hyphens

    if (!suffix) continue;

    const attempt = `${baseName}-${suffix}`;
    if (validateWorkspaceName(attempt) !== true) continue;

    const exists = await checkWorkspaceExists(attempt);
    if (!exists) return attempt;
  }

  // 2. Fall back to numeric suffixes
  for (let i = 2; i <= 99; i++) {
    const attempt = `${baseName}-${i}`;
    if (validateWorkspaceName(attempt) !== true) continue;

    const exists = await checkWorkspaceExists(attempt);
    if (!exists) return attempt;
  }

  throw new Error(`Could not resolve workspace name conflict for "${baseName}" — all attempted names already exist.`);
};
