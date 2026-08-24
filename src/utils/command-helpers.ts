import { Command } from 'commander';
import { listWorkspaces } from './workspace-meta';
import { promptWorkspaceSelection } from './prompts';

export interface GlobalOpts {
  forceRefresh: boolean;
  yes: boolean;
}

/**
 * Extract global options (--force-refresh, --yes) from the root program.
 * Commander doesn't auto-inherit parent options to subcommands,
 * so we walk up the parent chain to find them.
 */
export function getGlobalOpts(cmd: Command): GlobalOpts {
  let root = cmd;
  while (root.parent) root = root.parent;
  const opts = root.opts();
  return {
    forceRefresh: opts.forceRefresh ?? false,
    yes: opts.yes ?? false,
  };
}

/**
 * Resolve workspace name: use provided value, or prompt interactively.
 * In non-interactive mode (no TTY), throws if no name provided.
 */
export async function resolveWorkspace(name?: string): Promise<string> {
  if (name) return name;
  if (!process.stdout.isTTY) {
    throw new Error('Workspace name required in non-interactive mode. Use --workspace <name> or provide as argument.');
  }
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    throw new Error('No workspaces found. Create one first with: nemus create');
  }
  return promptWorkspaceSelection(workspaces);
}

/**
 * Parse comma-separated list from a flag value.
 */
export function parseList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}
