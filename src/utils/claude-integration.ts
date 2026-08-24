import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { GitHubRepo, WorkspaceMetadata } from '../types';
import { logSuccess, logWarning } from './logger';
import { colorize } from './colors';
import { getUserConfig } from './config';
import { getContextFileNames, getAllKnownContextFileNames } from './agent-config';

interface ClaudeConfig {
  autoLaunch: boolean;
  generateContext: boolean;
}

const DEFAULT_CONFIG: ClaudeConfig = {
  autoLaunch: false,
  generateContext: true,
};

/**
 * Version of the AI Agent Rules block. Bump whenever the rules text in
 * {@link buildAgentRulesSection} changes, so {@link backfillAgentRules}
 * replaces a previously-embedded (now stale) block in existing workspaces.
 */
export const AGENT_RULES_VERSION = 2;

/** Locate + version the rules block in an existing context file. */
const AGENT_RULES_MARKER_RE = /<!-- ws-rules:v(\d+) -->/;

/**
 * Build the "AI Agent Rules" markdown section for a given workspace.
 * Used both in new-workspace generation and in the upgrade backfill.
 */
export function buildAgentRulesSection(workspaceName: string): string {
  let s = `## AI Agent Rules\n\n`;
  s += `<!-- ws-rules:v${AGENT_RULES_VERSION} -->\n`;
  s += `**NEVER** use \`git clone\` directly to add repositories to this workspace.\n`;
  s += `**ALWAYS** use workspace manager commands for all repo management:\n\n`;
  s += `| Intent | Command |\n`;
  s += `|---|---|\n`;
  s += `| Add a repo to this workspace | \`w update --workspace ${workspaceName} --repos <repo-name> --yes\` |\n`;
  s += `| Sync / pull latest on all repos | \`w sync ${workspaceName}\` |\n`;
  s += `| Check git status across repos | \`w status ${workspaceName}\` |\n`;
  s += `| Create a new workspace | \`w create --workspace <name> --repos <repos> --yes\` |\n`;
  s += `\nUsing \`git clone\` directly bypasses workspace metadata tracking and breaks \`w status\`, \`w sync\`, and context file updates.\n\n`;
  s += `**ONLY read code from repos in THIS workspace.** If you need to read or reference code from a repo that isn't here, add it with \`w update --workspace ${workspaceName} --repos <repo-name> --yes\` and read it from this workspace. **NEVER** read that repo's code from another workspace, a global ghq/clone path, or anywhere outside this workspace — other workspaces may be on different branches or stale, and reading them silently breaks context isolation.\n\n`;
  return s;
}

/**
 * Backfill (or update) the "AI Agent Rules" section in existing context files
 * (AGENTS.md / .claude.md).
 *
 * - If the section is missing entirely, it is inserted.
 * - If the section is present but carries an older `ws-rules:vN` marker (or no
 *   marker at all, i.e. a pre-versioning block), it is REPLACED in place with
 *   the current version. This is how rule changes reach existing workspaces
 *   on `w mcp upgrade` / migrate.
 * - If the section is already at the current version, the file is left untouched.
 *
 * Idempotent. Returns the number of files updated.
 */
export async function backfillAgentRules(workspacePath: string, workspaceName: string): Promise<number> {
  const contextFileNames = getContextFileNames();
  let updated = 0;

  for (const fileName of contextFileNames) {
    const filePath = path.join(workspacePath, fileName);
    let existing: string;
    try {
      existing = await fs.readFile(filePath, 'utf-8');
    } catch {
      continue; // file doesn't exist — skip
    }

    const rulesBlock = buildAgentRulesSection(workspaceName);
    let patched: string;

    if (existing.includes('## AI Agent Rules')) {
      // Section already present — check its version marker.
      const marker = existing.match(AGENT_RULES_MARKER_RE);
      const embeddedVersion = marker ? parseInt(marker[1], 10) : 0;
      if (embeddedVersion >= AGENT_RULES_VERSION) continue; // already current

      // Replace the stale block (from its "## AI Agent Rules" heading up to,
      // but not including, the next "## " heading or EOF).
      // Match the heading and body up to the next "## " heading or EOF.
      // Tolerate CRLF (\r\n) line endings so Windows-authored context files
      // also get their stale block replaced.
      const sectionRe = /## AI Agent Rules\r?\n[\s\S]*?(?=\r?\n## |$)/;
      // buildAgentRulesSection ends with a trailing blank line; trim one so the
      // spacing before the following heading stays consistent on replace.
      patched = existing.replace(sectionRe, rulesBlock.replace(/\n+$/, '\n'));
      if (patched === existing) continue; // nothing changed (defensive)
    } else {
      // Section missing — insert it before Tips, else before Notes, else append.
      if (existing.includes('## Tips for Working with AI Agents')) {
        patched = existing.replace('## Tips for Working with AI Agents', `${rulesBlock}## Tips for Working with AI Agents`);
      } else if (existing.includes('## Notes')) {
        patched = existing.replace('## Notes', `${rulesBlock}## Notes`);
      } else {
        patched = existing + `\n${rulesBlock}`;
      }
    }

    await fs.writeFile(filePath, patched, 'utf-8');
    updated++;
  }

  return updated;
}


export async function loadClaudeConfig(): Promise<ClaudeConfig> {
  const configFile = path.join(process.env.HOME || '~', '.workspace-manager-claude-config.json');

  try {
    const content = await fs.readFile(configFile, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Save Claude integration config
 */
export async function saveClaudeConfig(config: ClaudeConfig): Promise<void> {
  const configFile = path.join(process.env.HOME || '~', '.workspace-manager-claude-config.json');

  try {
    await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logWarning('Failed to save Claude config');
  }
}

/**
 * Generate context files (e.g. .claude.md, AGENTS.md) with workspace context.
 * Writes to all context file names configured for active agents.
 */
export async function generateClaudeContext(
  workspacePath: string,
  workspaceName: string,
  repos: GitHubRepo[],
  metadata?: WorkspaceMetadata
): Promise<void> {
  try {
    const contextFileNames = getContextFileNames();

    // Build a lookup from repo name to GitHubRepo for description/url
    const repoInfoMap = new Map<string, GitHubRepo>();
    for (const r of repos) {
      repoInfoMap.set(r.name, r);
    }

    // Build the list of repo entries to iterate over. Use metadata.repositories
    // as the primary source (each entry has a unique directoryName, handling
    // duplicate repos with different suffixes). Fall back to repos array.
    interface RepoEntry { name: string; directoryName: string; description: string; url: string }
    const entries: RepoEntry[] = [];
    if (metadata && metadata.repositories.length > 0) {
      for (const r of metadata.repositories.filter(r => r.status === 'success')) {
        const info = repoInfoMap.get(r.name);
        entries.push({
          name: r.name,
          directoryName: r.directoryName,
          description: info?.description || '',
          url: info?.url || r.cloneUrl,
        });
      }
    } else {
      for (const r of repos) {
        entries.push({
          name: r.name,
          directoryName: r.name,
          description: r.description || '',
          url: r.url,
        });
      }
    }

    const { githubOrg } = getUserConfig();

    let content = `# Workspace: ${workspaceName}

This workspace was created with [Workspace Manager](https://github.com/${githubOrg}/workspace-manager).

## Organization

All repositories in this workspace belong to the **${githubOrg}** GitHub organization (\`github.com/${githubOrg}\`). When searching for code, packages, or dependencies, assume the \`@${githubOrg}\` npm scope and the \`${githubOrg}/\` GitHub org prefix.

## Overview

This workspace contains ${entries.length} repositories for focused development work.

`;

    // Add creation date if available
    if (metadata?.createdAt) {
      const createdDate = new Date(metadata.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      content += `**Created:** ${createdDate}\n\n`;
    }

    // Add original prompt if available
    if (metadata?.prompt) {
      content += `**Original prompt:** ${metadata.prompt}\n\n`;
    }

    // Add repositories section
    content += `## Repositories\n\n`;

    // Group entries by prefix for display
    const grouped = groupEntriesByPrefix(entries);

    if (Object.keys(grouped).length > 1) {
      for (const [prefix, groupEntries] of Object.entries(grouped)) {
        if (prefix !== 'other') {
          content += `### ${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Services\n\n`;
        } else {
          content += `### Other Repositories\n\n`;
        }

        for (const entry of groupEntries) {
          const description = entry.description ? ` - ${entry.description}` : '';
          const aliasNote = entry.directoryName !== entry.name ? ` (instance: ${entry.directoryName})` : '';
          content += `- **${entry.name}**${aliasNote}${description}\n`;
          content += `  - Path: \`${entry.directoryName}/\`\n`;
          content += `  - GitHub: ${entry.url}\n\n`;
        }
      }
    } else {
      for (const entry of entries) {
        const description = entry.description ? ` - ${entry.description}` : '';
        const aliasNote = entry.directoryName !== entry.name ? ` (instance: ${entry.directoryName})` : '';
        content += `### ${entry.directoryName}${aliasNote}\n\n`;
        content += `${description}\n\n`;
        content += `- Path: \`${entry.directoryName}/\`\n`;
        content += `- GitHub: ${entry.url}\n\n`;
      }
    }

    // Workspace structure will be added per-file (different context file names)
    const allDirNames = entries.map(e => e.directoryName);
    content += '{{WORKSPACE_STRUCTURE}}\n';

    // Embed per-repo context files HERE — right after the workspace structure,
    // before generic workflow/management boilerplate. LLMs weight earlier
    // content more heavily, so per-repo rules need to be at the top of the
    // file, not buried 80 lines down after generic tips.
    const perRepoSection = await buildPerRepoContextSection(workspacePath, allDirNames);
    if (perRepoSection) {
      content += perRepoSection + '\n';
    }

    // Add common workflows
    content += `## Common Workflows\n\n`;
    content += `### Opening Specific Repository\n\n`;
    content += '```bash\n';
    content += `cd ${allDirNames[0] || '<repo-name>'}\n`;
    content += '# Work on specific repository\n';
    content += '```\n\n';

    content += `### Running Commands Across All Repos\n\n`;
    content += '```bash\n';
    content += '# Example: Check git status for all repos\n';
    content += 'for dir in */; do\n';
    content += '  echo "=== $dir ===" && cd "$dir" && git status -s && cd ..\n';
    content += 'done\n';
    content += '```\n\n';

    // Add workspace management commands
    content += `## Workspace Management\n\n`;
    content += `These commands help you manage this workspace:\n\n`;
    content += '```bash\n';
    content += 'workspace sync              # Pull latest changes for all repos\n';
    content += 'workspace switch-branch     # Switch all repos to same branch\n';
    content += 'workspace update            # Add more repositories\n';
    content += 'workspace suite create       # Save repos as a reusable suite\n';
    content += '```\n\n';

    // Add explicit AI agent rules — prevent direct git clone
    content += buildAgentRulesSection(workspaceName);

    // Add tips section
    content += `## Tips for Working with AI Agents\n\n`;
    content += `- **Multi-repo context**: Your AI agent can see all repositories in this workspace\n`;
    content += `- **Cross-repo changes**: Ask the agent to make changes across multiple repos\n`;
    content += `- **Architecture questions**: The agent has context of your entire stack\n`;
    content += `- **Workspace commands**: Use the workspace manager commands above\n\n`;

    // Add notes section
    content += `## Notes\n\n`;
    content += `Add your own notes here:\n\n`;
    content += `- \n\n`;

    // Reference CONTEXT.md if it exists (saved progress from w save-context)
    content += `## Saved Context\n\n`;
    content += `If a \`CONTEXT.md\` file exists in this workspace, it contains saved progress and summaries from previous sessions. Read it for continuity after \`/clear\` or when resuming work.\n\n`;

    // Write context file for each active agent (customize structure per-file)
    for (const fileName of contextFileNames) {
      // Build workspace structure block with correct filename
      const padding = ' '.repeat(Math.max(1, 28 - fileName.length));
      const structureBlock =
        '## Workspace Structure\n\n' +
        '```\n' +
        `${workspaceName}/\n` +
        `├── ${fileName}${padding}# Workspace context\n` +
        `├── .workspace-meta.json          # Workspace metadata\n` +
        `├── CONTEXT.md                    # Saved progress (if exists)\n` +
        allDirNames.slice(0, 5).map(d => `├── ${d}/\n`).join('') +
        (allDirNames.length > 5 ? `└── ... (${allDirNames.length - 5} more repositories)\n` : '') +
        '```\n\n';

      // Insert structure block at placeholder
      const fileContent = content.replace('{{WORKSPACE_STRUCTURE}}\n', structureBlock);
      const contextFile = path.join(workspacePath, fileName);
      await fs.writeFile(contextFile, fileContent, 'utf-8');
      logSuccess(`Generated ${colorize(fileName, 'cyan')} with workspace context`);
    }

    // Generate .mcp.json with workspace-manager MCP server (if enabled)
    const { installMcp } = getUserConfig();
    if (installMcp) {
      await generateMcpConfig(workspacePath);
    }
  } catch (error) {
    logWarning('Failed to generate context file(s)');
    if (error instanceof Error) {
      logWarning(error.message);
    }
  }
}

/**
 * Resolve the MCP server.js path from the installed package.
 * When compiled, __dirname is dist/utils/ — server.js is at dist/mcp/server.js.
 */
function resolveMcpServerPath(): string | null {
  const candidates = [
    path.join(__dirname, '..', 'mcp', 'server.js'),           // dist/utils/ -> dist/mcp/server.js
    path.join(__dirname, '..', '..', 'dist', 'mcp', 'server.js'), // src/utils/ -> dist/mcp/server.js
  ];
  for (const p of candidates) {
    if (fsSync.existsSync(p)) {
      return path.resolve(p);
    }
  }
  return null;
}

/**
 * Generate .mcp.json with workspace-manager MCP server config.
 * This ensures Claude Code sessions in the workspace have access to
 * workspace-manager tools even without global MCP registration.
 */
export async function generateMcpConfig(workspacePath: string): Promise<boolean> {
  try {
    const mcpFile = path.join(workspacePath, '.mcp.json');
    const serverPath = resolveMcpServerPath();

    if (!serverPath) {
      logWarning('Could not resolve MCP server path — skipping .mcp.json generation');
      return false;
    }

    let existingConfig: any = {};
    try {
      const existingContent = await fs.readFile(mcpFile, 'utf-8');
      existingConfig = JSON.parse(existingContent);
    } catch {
      // No existing config or invalid JSON — start fresh
    }

    const mcpConfig = {
      ...existingConfig,
      mcpServers: {
        ...(existingConfig.mcpServers || {}),
        'workspace-manager': {
          command: 'node',
          args: [serverPath],
        },
      },
    };

    await fs.writeFile(mcpFile, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8');
    logSuccess(`Generated ${colorize('.mcp.json', 'cyan')} with workspace-manager MCP server`);
    return true;
  } catch (error) {
    logWarning('Failed to generate .mcp.json file');
    return false;
  }
}

const KNOWN_PREFIXES = ['api', 'service', 'lib', 'tool', 'app', 'web', 'mobile', 'backend', 'frontend'];

/**
 * How many directory levels below the repo root to scan for context files.
 *   0 = repo root only   (e.g. repo/AGENTS.md)
 *   1 = one level deep   (e.g. repo/packages/AGENTS.md)
 *   2 = two levels deep  (e.g. repo/packages/ui/AGENTS.md)
 * Keep this low — deeper scans grow quickly and context files are rarely nested.
 */
const PER_REPO_MAX_DEPTH = 2;

/**
 * Directories that are never useful to scan for context files.
 */
const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '__pycache__', '.turbo', '.cache', 'out', 'tmp', '.tmp',
]);

/**
 * Recursively find context files within a directory, up to maxDepth levels
 * below the starting point. Skips SCAN_SKIP_DIRS to avoid scanning build
 * artifacts, dependencies, or git internals.
 *
 * @param dirPath     Absolute path of the directory to scan.
 * @param candidates  File names to look for (from getAllKnownContextFileNames).
 * @param repoRoot    Absolute path of the repo root (used to build relative labels).
 * @param maxDepth    Maximum levels to descend from dirPath.
 * @param depth       Current recursion depth (0 = dirPath itself).
 */
async function findContextFilesInDir(
  dirPath: string,
  candidates: string[],
  repoRoot: string,
  maxDepth: number,
  depth: number = 0,
): Promise<Array<{ relPath: string; fileName: string; content: string }>> {
  const results: Array<{ relPath: string; fileName: string; content: string }> = [];

  // Check for a context file at this level (first candidate that exists wins).
  for (const fileName of candidates) {
    let content: string;
    try {
      content = await fs.readFile(path.join(dirPath, fileName), 'utf-8');
    } catch {
      continue;
    }
    if (!content?.trim()) continue;

    const relPath = path.relative(repoRoot, dirPath) || '.';
    results.push({ relPath, fileName, content: content.trim() });
    break; // one file per directory level
  }

  // Recurse into subdirectories if we haven't hit the depth limit.
  if (depth < maxDepth) {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SCAN_SKIP_DIRS.has(entry.name)) continue;
      const sub = await findContextFilesInDir(
        path.join(dirPath, entry.name),
        candidates,
        repoRoot,
        maxDepth,
        depth + 1,
      );
      results.push(...sub);
    }
  }

  return results;
}

/**
 * Scan each repo subdirectory for context files (AGENTS.md / .claude.md / …)
 * and embed the contents inline in the workspace-level context file.
 * Covers ALL known agents (not just the configured one) because individual
 * repos may have been set up with a different agent.
 *
 * Scans up to PER_REPO_MAX_DEPTH levels inside each repo so monorepo
 * packages are included, while still having a stop condition that prevents
 * runaway recursion into large dependency trees.
 *
 * Returns a markdown section string, or null when no per-repo files exist.
 */
export async function buildPerRepoContextSection(
  workspacePath: string,
  dirNames: string[],
): Promise<string | null> {
  const candidates = getAllKnownContextFileNames();
  const sections: string[] = [];

  for (const dir of dirNames) {
    const repoRoot = path.join(workspacePath, dir);
    const found = await findContextFilesInDir(
      repoRoot, candidates, repoRoot, PER_REPO_MAX_DEPTH,
    );

    for (const { relPath, fileName, content } of found) {
      const label = relPath === '.' ? dir : `${dir}/${relPath}`;
      // Demote heading levels by 3 so the repo's content nests properly
      // under '### `repo/` ...' — prevents repo's '## Architecture' from
      // colliding with workspace headings like '## Notes'.
      // Caps at h6 (markdown’s deepest level).
      // Critically, only touch lines OUTSIDE fenced code blocks so that
      // shell comments like '# Build the project' inside ```bash blocks
      // are not corrupted.
      const demoted = (() => {
        const out: string[] = [];
        let inFence = false;
        let fenceMarker = '';
        for (const line of content.split('\n')) {
          const fenceMatch = line.match(/^(```+|~~~+)/);
          if (fenceMatch) {
            if (!inFence) {
              inFence = true;
              fenceMarker = fenceMatch[1];
            } else if (line.startsWith(fenceMarker)) {
              inFence = false;
              fenceMarker = '';
            }
            out.push(line);
            continue;
          }
          if (!inFence) {
            const headingMatch = line.match(/^(#{1,6})(\s|$)/);
            if (headingMatch) {
              const newLevel = Math.min(6, headingMatch[1].length + 3);
              out.push('#'.repeat(newLevel) + line.slice(headingMatch[1].length));
              continue;
            }
          }
          out.push(line);
        }
        return out.join('\n');
      })();

      sections.push(
        `### \`${label}/\` — repo-specific rules (${fileName})\n\n` +
        `**You MUST follow these rules whenever you work with files inside ` +
        `\`${label}/\`. They override generic workspace guidance for that repo.**\n\n` +
        demoted.trim() + '\n\n---\n',
      );
    }
  }

  if (sections.length === 0) return null;

  return (
    `## Per-Repository Context\n\n` +
    `Each repository in this workspace below has its own \`AGENTS.md\` / ` +
    `\`CLAUDE.md\` file. Their contents are embedded verbatim here.\n\n` +
    `**When you work on files inside a specific repo subdirectory, the rules ` +
    `in that repo’s section are AUTHORITATIVE for that repo — follow them ` +
    `literally. They take precedence over generic workspace-level guidance.**\n\n` +
    `---\n\n` +
    sections.join('\n')
  );
}


function getPrefixForName(name: string): string {
  const parts = name.split('-');
  if (parts.length > 1 && KNOWN_PREFIXES.includes(parts[0].toLowerCase())) {
    return parts[0].toLowerCase();
  }
  return 'other';
}

/**
 * Group repositories by common prefix
 */
function groupReposByPrefix(repos: GitHubRepo[]): Record<string, GitHubRepo[]> {
  const groups: Record<string, GitHubRepo[]> = {};
  for (const repo of repos) {
    const prefix = getPrefixForName(repo.name);
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(repo);
  }
  return groups;
}

function groupEntriesByPrefix<T extends { name: string }>(entries: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const entry of entries) {
    const prefix = getPrefixForName(entry.name);
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(entry);
  }
  return groups;
}

