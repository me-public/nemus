import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WORKSPACES_DIR, META_FILENAME } from '../utils/config';
import { logInfo, logSuccess, logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { loadMetadata, saveMetadata, listWorkspaces } from '../utils/workspace-meta';
import { formatContextFile, appendToContextFile } from '../utils/context-file';
import { select } from '../utils/prompt';

const CONTEXT_FILENAME = 'CONTEXT.md';

export function registerSaveContextCommand(parent: Command) {
  parent
    .command('save-context')
    .alias('ctx')
    .description('Save a progress summary to the workspace (persists across /clear)')
    .option('-w, --workspace <name>', 'Workspace name (default: current directory)')
    .option('-m, --message <text>', 'Summary text to save')
    .option('-f, --file <path>', 'Read summary from a file')
    .option('--append', 'Append to existing context instead of replacing')
    .action(async (opts) => {
      await handleSaveContext(opts);
    });
}

async function resolveWorkspacePath(workspaceName?: string): Promise<{ name: string; path: string } | null> {
  // Try current directory first
  if (!workspaceName) {
    const cwd = process.cwd();
    const metaPath = path.join(cwd, META_FILENAME);
    try {
      await fs.access(metaPath);
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      return { name: meta.workspaceName || path.basename(cwd), path: cwd };
    } catch {
      // Not in a workspace directory — check if we're inside a workspace subdirectory
      const parentDir = path.dirname(cwd);
      const parentMeta = path.join(parentDir, META_FILENAME);
      try {
        await fs.access(parentMeta);
        const meta = JSON.parse(await fs.readFile(parentMeta, 'utf-8'));
        return { name: meta.workspaceName || path.basename(parentDir), path: parentDir };
      } catch {
        // Not in any workspace
      }
    }
  }

  // Use provided workspace name
  if (workspaceName) {
    const wsPath = path.join(WORKSPACES_DIR, workspaceName);
    try {
      await fs.access(path.join(wsPath, META_FILENAME));
      return { name: workspaceName, path: wsPath };
    } catch {
      logError(`Workspace not found: ${workspaceName}`);
      return null;
    }
  }

  // Interactive selection
  if (process.stdout.isTTY) {
    const workspaces = await listWorkspaces(false);
    if (workspaces.length === 0) {
      logError('No workspaces found');
      return null;
    }
    const selected = await select({
      message: 'Select workspace:',
      choices: workspaces.map(w => ({ name: w.name, value: w.name })),
    });
    return { name: selected, path: path.join(WORKSPACES_DIR, selected) };
  }

  logError('Could not determine workspace. Use --workspace <name> or run from within a workspace.');
  return null;
}

async function handleSaveContext(opts: {
  workspace?: string;
  message?: string;
  file?: string;
  append?: boolean;
}) {
  const ws = await resolveWorkspacePath(opts.workspace);
  if (!ws) return;

  // Get content from message, file, or stdin
  let content: string;
  if (opts.message) {
    content = opts.message;
  } else if (opts.file) {
    try {
      content = await fs.readFile(opts.file, 'utf-8');
    } catch (err) {
      logError(`Failed to read file: ${opts.file}`);
      return;
    }
  } else if (!process.stdin.isTTY) {
    // Read from stdin (piped input)
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    content = Buffer.concat(chunks).toString('utf-8').trim();
  } else {
    logError('No content provided. Use --message, --file, or pipe content via stdin.');
    console.log(`\n  Usage:`);
    console.log(`    ${colorize('w save-context -m "Completed auth refactor, moved to payments"', 'green')}`);
    console.log(`    ${colorize('w save-context -f summary.md', 'green')}`);
    console.log(`    ${colorize('echo "progress notes" | w save-context', 'green')}`);
    return;
  }

  if (!content.trim()) {
    logError('Empty content — nothing to save.');
    return;
  }

  const contextPath = path.join(ws.path, CONTEXT_FILENAME);

  if (opts.append) {
    let existing: string | null = null;
    try {
      existing = await fs.readFile(contextPath, 'utf-8');
    } catch {
      // File doesn't exist yet
    }
    content = appendToContextFile(existing, ws.name, content);
  } else {
    content = formatContextFile(ws.name, content);
  }

  await fs.writeFile(contextPath, content, 'utf-8');
  logSuccess(`Context saved to ${colorize(CONTEXT_FILENAME, 'cyan')} in ${ws.name}`);
  logInfo('This file persists across /clear and session restarts.');
}

