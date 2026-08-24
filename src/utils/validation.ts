import * as fs from 'fs/promises';
import { WORKSPACES_DIR } from './config';
import * as path from 'path';

const WORKSPACE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

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
