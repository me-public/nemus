import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { WORKSPACES_DIR, getUserConfig } from '../utils/config';
import { listWorkspaces, loadMetadata, saveMetadata } from '../utils/workspace-meta';
import { generateClaudeContext, buildPerRepoContextSection } from '../utils/claude-integration';
import { logInfo, logSuccess, logError, logWarning } from '../utils/logger';
import { colorize } from '../utils/colors';
import { WorkspaceMetadata, RepositoryMetadata } from '../types';
import { getContextFileNames } from '../utils/agent-config';

export function registerMigrateCommand(parent: Command) {
  parent
    .command('migrate')
    .description('Migrate all workspaces to latest format (regenerate context files, update metadata)')
    .option('--dry-run', 'Show what would be changed without making changes')
    .action(async (opts) => {
      await handleMigrate(opts);
    });
}

async function handleMigrate(opts: { dryRun?: boolean }) {
  const dryRun = opts.dryRun ?? false;

  if (dryRun) {
    logInfo('Dry run mode - no changes will be made\n');
  }

  const workspaces = await listWorkspaces(false);
  if (workspaces.length === 0) {
    logInfo('No workspaces found. Nothing to migrate.');
    return;
  }

  logInfo(`Found ${colorize(String(workspaces.length), 'cyan')} workspaces to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const ws of workspaces) {
    const wsPath = ws.path;
    const metadata = await loadMetadata(wsPath);

    if (!metadata) {
      // No metadata file - reconstruct it by scanning git subdirectories
      logWarning(`${ws.name}: no metadata found - reconstructing from git repos`);
      const reconstructed = await reconstructMetadata(ws.name, wsPath);
      if (!reconstructed) {
        logError(`  ${ws.name}: could not reconstruct metadata (no git repos found), skipping`);
        skipped++;
        continue;
      }
      if (!dryRun) {
        await saveMetadata(wsPath, reconstructed);
        logSuccess(`  ${colorize(ws.name, 'cyan')}: metadata created (${reconstructed.repositories.length} repos detected)`);
      } else {
        logInfo(`  ${colorize(ws.name, 'cyan')}: would create metadata (${reconstructed.repositories.length} repos detected)`);
      }
      // Regenerate context files using the reconstructed metadata.
      const meta = reconstructed;
      if (!dryRun) {
        const repos = meta.repositories
          .filter(r => r.status === 'success')
          .map(r => ({ name: r.name, description: '', url: r.cloneUrl, owner: { login: r.owner }, sshUrl: r.cloneUrl }));
        try {
          await generateClaudeContext(wsPath, ws.name, repos as any, meta);
        } catch { /* context gen is best-effort */ }
      }
      migrated++;
      continue;
    }

    try {
      const dirNames = metadata.repositories
        .filter(r => r.status === 'success')
        .map(r => r.directoryName);

      const contextFiles = getContextFileNames();

      // Read all existing context files first — before any writes.
      // If any file is missing we must fall back to full regeneration;
      // we determine this BEFORE touching anything so we never mix
      // surgical patches with a subsequent full overwrite.
      const existingContents = new Map<string, string>();
      let needsFullRegen = false;
      for (const fileName of contextFiles) {
        try {
          existingContents.set(fileName, await fs.readFile(path.join(wsPath, fileName), 'utf-8'));
        } catch {
          needsFullRegen = true;
          break;
        }
      }

      // Build the per-repo section (needs disk access; do once for both paths).
      const perRepoSection = await buildPerRepoContextSection(wsPath, dirNames);
      const repoCount = perRepoSection ? (perRepoSection.match(/^###/gm) || []).length : 0;

      if (dryRun) {
        if (needsFullRegen) {
          logInfo(`  ${colorize(ws.name, 'cyan')}: would regenerate context files from scratch (context file missing)`);
        } else if (repoCount > 0) {
          logInfo(`  ${colorize(ws.name, 'cyan')}: would embed per-repo context from ${repoCount} location(s) into ${contextFiles.join(', ')}`);
        } else {
          logInfo(`  ${colorize(ws.name, 'cyan')}: would update ${contextFiles.join(', ')} (no per-repo context files found — any existing section removed)`);
        }
        migrated++;
        continue;
      }

      // Ensure lastModified is set
      if (!metadata.lastModified) {
        metadata.lastModified = new Date().toISOString();
        await saveMetadata(wsPath, metadata);
      }

      if (needsFullRegen) {
        // One or more context files are missing — regenerate all from scratch.
        const repos = metadata.repositories
          .filter(r => r.status === 'success')
          .map(r => ({
            name: r.name, description: '', url: r.cloneUrl,
            owner: { login: r.owner }, sshUrl: r.cloneUrl,
          }));
        await generateClaudeContext(wsPath, ws.name, repos as any, metadata);
      } else {
        // All context files exist — patch only the per-repo section in each.
        for (const [fileName, existing] of existingContents) {
          const updated = upsertPerRepoSection(existing, perRepoSection);
          if (updated !== existing) {
            await fs.writeFile(path.join(wsPath, fileName), updated, 'utf-8');
          }
        }
      }

      const detail = needsFullRegen
        ? ' (regenerated from scratch)'
        : repoCount > 0
          ? ` (embedded per-repo context from ${repoCount} location(s))`
          : ' (no per-repo context files found)';
      logSuccess(`  ${colorize(ws.name, 'cyan')}: migrated${detail}`);
      migrated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`  ${ws.name}: ${msg}`);
      errors++;
    }
  }

  console.log('');
  logInfo(dryRun ? 'Dry run complete:' : 'Migration complete:');
  console.log(`  ${colorize(String(migrated), 'green')} ${dryRun ? 'would migrate' : 'migrated'}`);
  if (skipped > 0) console.log(`  ${colorize(String(skipped), 'yellow')} skipped`);
  if (errors > 0) console.log(`  ${colorize(String(errors), 'red')} errors`);
}

/**
 * Reconstruct a WorkspaceMetadata object for a workspace that has no metadata
 * file by scanning subdirectories for git repositories and reading their
 * remote origin URLs.
 *
 * Returns null if no git repos are found in the workspace directory.
 */
async function reconstructMetadata(
  workspaceName: string,
  workspacePath: string,
): Promise<WorkspaceMetadata | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(workspacePath);
  } catch {
    return null;
  }

  const repositories: RepositoryMetadata[] = [];

  for (const entry of entries) {
    const repoPath = path.join(workspacePath, entry);
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) continue;

      // Check it's a git repo
      await fs.access(path.join(repoPath, '.git'));

      // Get the remote origin URL
      let cloneUrl = '';
      let owner = getUserConfig().githubOrg || 'your-org';
      try {
        cloneUrl = execSync('git remote get-url origin', {
          cwd: repoPath, stdio: 'pipe', encoding: 'utf-8',
        }).trim();
        // Extract owner from SSH URL: git@github.com:owner/repo.git
        const sshMatch = cloneUrl.match(/github\.com[:/]([^/]+)\//);
        if (sshMatch) owner = sshMatch[1];
      } catch { /* no remote - leave blank */ }

      // Derive the canonical repo name from the remote URL, falling back
      // to the directory name.
      let repoName = entry;
      try {
        const urlMatch = cloneUrl.match(/\/([^/]+?)\.git$/) ||
                         cloneUrl.match(/\/([^/]+)$/);
        if (urlMatch) repoName = urlMatch[1];
      } catch { /* use directory name */ }

      repositories.push({
        name: repoName,
        directoryName: entry,
        owner,
        clonedAt: new Date().toISOString(),
        cloneUrl,
        status: 'success',
      });
    } catch { /* not accessible or not a git repo - skip */ }
  }

  if (repositories.length === 0) return null;

  return {
    workspaceName,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    repositories,
  };
}

/**
 * Insert or replace the '## Per-Repository Context' section in an existing
 * workspace context file, leaving everything else (user notes, etc.) intact.
 *
 * Insertion order (preferred first — we want the section as early as
 * possible so the LLM weights it heavily):
 *   1. Before '## Common Workflows'   — the new canonical position
 *   2. Before '## Workspace Management' (older layouts)
 *   3. Before '## AI Agent Rules'      (older layouts)
 *   4. Before '## Tips for Working'    (older layouts)
 *   5. Before '## Notes'               (legacy fallback)
 *   6. Before '## Saved Context'       (legacy fallback)
 *   7. Appended at the end             (last resort)
 *
 * If `newSection` is null the existing section (if any) is removed so that
 * a workspace that previously had per-repo context but no longer does gets
 * cleaned up.
 */
function upsertPerRepoSection(content: string, newSection: string | null): string {
  // Match the section *including* its leading blank line(s) so removal
  // leaves a clean join with no leftover blank lines. No 'm' flag so '$'
  // only matches the true end-of-string.
  const sectionRegex = /\n{1,2}## Per-Repository Context\b[\s\S]*?(?=\n## |\n#{1,2} |$)/;
  // Only trimEnd() the very end of the file — never touch the body.
  const base = content.replace(sectionRegex, '').trimEnd();

  if (!newSection) return base + '\n'; // section removed, nothing to add back

  const block = `\n\n${newSection.trim()}\n`;

  // Try anchors in order of preference — earliest first so per-repo rules
  // are read by the LLM before generic boilerplate.
  const anchors = [
    '\n## Common Workflows',
    '\n## Workspace Management',
    '\n## AI Agent Rules',
    '\n## Tips for Working',
    '\n## Notes',
    '\n## Saved Context',
  ];
  for (const anchor of anchors) {
    if (base.includes(anchor)) {
      return base.replace(anchor, `${block}${anchor}`);
    }
  }
  // Append (last resort)
  return base + block;
}
