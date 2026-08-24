#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleListWorkspaces,
  handleWorkspaceStatus,
  handleWorkspaceDiff,
  handleWorkspaceSync,
  handleRunCommand,
  handleListSuites,
  handleWorkspaceInfo,
  handleCreateWorkspace,
  handleUpdateWorkspace,
  handleSearchRepos,
  handleListOrgRepos,
  handleDeleteWorkspace,
  handleRemoveRepo,
  handleWorkspaceDoctor,
  handleAnalyzeDeps,
  handleBranchCreate,
  handleSwitchBranch,
  handleWorkspaceCleanup,
  handleUpdateCache,
  handleArchiveWorkspace,
  handleUnarchiveWorkspace,
  handleBranchMerge,
  handleBranchRebase,
  handleSuiteCreate,
  handleSuiteDelete,
  handleSuiteExport,
  handleSuiteImport,
  handleSuiteUse,
  handleSaveContext,
} from './tools';

import { getPackageVersion } from '../utils/config';

const server = new McpServer({
  name: 'workspace-manager',
  version: getPackageVersion(),
});

server.tool(
  'list-workspaces',
  'List all workspaces with their repo counts and creation dates',
  {
    includeArchived: z.boolean().optional().default(false).describe('Include archived workspaces in the listing'),
  },
  async ({ includeArchived }) => {
    try {
      const result = await handleListWorkspaces(includeArchived);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'archive-workspace',
  'Archive a workspace so it is hidden from default listing. Archived workspaces auto-delete after 30 days.',
  {
    workspace: z.string().describe('Name of the workspace to archive'),
  },
  async ({ workspace }) => {
    try {
      const result = await handleArchiveWorkspace(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'unarchive-workspace',
  'Unarchive a previously archived workspace, making it active again',
  {
    workspace: z.string().describe('Name of the workspace to unarchive'),
  },
  async ({ workspace }) => {
    try {
      const result = await handleUnarchiveWorkspace(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-status',
  'Show git status (branch, clean/dirty, ahead/behind) for all repos in a workspace',
  { workspace: z.string().describe('Name of the workspace') },
  async ({ workspace }) => {
    try {
      const result = await handleWorkspaceStatus(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-diff',
  'Show diff summary (staged/unstaged file counts, insertions, deletions) for all repos in a workspace',
  {
    workspace: z.string().describe('Name of the workspace'),
    full: z.boolean().optional().describe('Include full diff output'),
  },
  async ({ workspace, full }) => {
    try {
      const result = await handleWorkspaceDiff(workspace, full);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-sync',
  'Git pull all repos in a workspace (skips repos with uncommitted changes)',
  { workspace: z.string().describe('Name of the workspace') },
  async ({ workspace }) => {
    try {
      const result = await handleWorkspaceSync(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'run-command',
  'Run a shell command across all repos in a workspace (3 concurrent, 5min timeout)',
  {
    workspace: z.string().describe('Name of the workspace'),
    command: z.string().describe('Shell command to run in each repo'),
  },
  async ({ workspace, command }) => {
    try {
      const result = await handleRunCommand(workspace, command);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'list-suites',
  'List all saved suites (reusable repo collections) with their repo counts',
  {},
  async () => {
    try {
      const result = await handleListSuites();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-info',
  'Get detailed metadata for a workspace including all repository info, dependencies, and tags',
  { workspace: z.string().describe('Name of the workspace') },
  async ({ workspace }) => {
    try {
      const result = await handleWorkspaceInfo(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'create-workspace',
  'Create a new workspace by cloning specified repositories. Provide the workspace name and an array of repository names (e.g., ["api", "web", "shared-lib"]).',
  {
    workspace: z.string().describe('Name of the workspace to create'),
    repos: z.array(z.string()).describe('Array of repository names to clone'),
  },
  async ({ workspace, repos }) => {
    try {
      const result = await handleCreateWorkspace(workspace, repos);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'update-workspace',
  'Add repositories to an existing workspace. Provide the workspace name and an array of repository names to add. Each entry can be a string (e.g., "partnerships-api") or an object with name and suffix (e.g., {"name": "partnerships-api", "suffix": "v2"}) to add the same repo again under a different directory name (partnerships-api-v2). Skips repos whose target directory name already exists in the workspace.',
  {
    workspace: z.string().describe('Name of the existing workspace to update'),
    repos: z.array(z.union([
      z.string(),
      z.object({
        name: z.string().describe('repository name'),
        suffix: z.string().describe('Suffix to append to directory name (e.g., "v2" creates "repo-name-v2")'),
      }),
    ])).describe('Array of repo names (strings) or objects with {name, suffix} for adding duplicate repos under a different directory'),
  },
  async ({ workspace, repos }) => {
    try {
      const result = await handleUpdateWorkspace(workspace, repos);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'search-repos',
  'Search org repositories by name or description using fuzzy matching',
  {
    query: z.string().describe('Search query to match against repo names and descriptions'),
    limit: z.number().optional().default(20).describe('Maximum number of results to return'),
  },
  async ({ query, limit }) => {
    try {
      const result = await handleSearchRepos(query, limit);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'list-org-repos',
  'List all organization repositories from GitHub',
  {
    forceRefresh: z.boolean().optional().default(false).describe('Force refresh the cached repo list'),
  },
  async ({ forceRefresh }) => {
    try {
      const result = await handleListOrgRepos(forceRefresh);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'delete-workspace',
  'Delete one or more workspaces and all their contents permanently. Works even if a workspace has no repos or no metadata file.',
  {
    workspaces: z.union([
      z.string(),
      z.array(z.string()),
    ]).describe('Name of the workspace(s) to delete — a single string or an array of names'),
  },
  async ({ workspaces }) => {
    try {
      const result = await handleDeleteWorkspace(workspaces);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'remove-repo',
  'Remove a repository from a workspace',
  {
    workspace: z.string().describe('Name of the workspace'),
    repo: z.string().describe('Directory name of the repository to remove'),
  },
  async ({ workspace, repo }) => {
    try {
      const result = await handleRemoveRepo(workspace, repo);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-doctor',
  'Run health checks on a workspace and return a health score (0-100)',
  {
    workspace: z.string().describe('Name of the workspace to check'),
  },
  async ({ workspace }) => {
    try {
      const result = await handleWorkspaceDoctor(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'analyze-deps',
  'Analyze inter-repository dependencies within a workspace and detect circular dependencies',
  {
    workspace: z.string().describe('Name of the workspace to analyze'),
  },
  async ({ workspace }) => {
    try {
      const result = await handleAnalyzeDeps(workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'branch-create',
  'Create a new branch across all repos in a workspace',
  {
    workspace: z.string().describe('Name of the workspace'),
    branchName: z.string().describe('Name of the new branch to create'),
    baseBranch: z.string().optional().describe('Base branch to create from (defaults to current branch)'),
  },
  async ({ workspace, branchName, baseBranch }) => {
    try {
      const result = await handleBranchCreate(workspace, branchName, baseBranch);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'switch-branch',
  'Switch all repos in a workspace to a specified branch',
  {
    workspace: z.string().describe('Name of the workspace'),
    branch: z.string().describe('Target branch to switch to'),
  },
  async ({ workspace, branch }) => {
    try {
      const result = await handleSwitchBranch(workspace, branch);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'workspace-cleanup',
  'Remove node_modules and build artifacts from all repos in a workspace to free disk space',
  {
    workspace: z.string().describe('Name of the workspace'),
    includeNodeModules: z.boolean().optional().default(true).describe('Remove node_modules directories'),
    includeBuildArtifacts: z.boolean().optional().default(true).describe('Remove build artifact directories (dist, build, .next, coverage, out)'),
  },
  async ({ workspace, includeNodeModules, includeBuildArtifacts }) => {
    try {
      const result = await handleWorkspaceCleanup(workspace, includeNodeModules, includeBuildArtifacts);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'update-cache',
  'Force refresh the GitHub repository cache so newly added repos become searchable',
  {},
  async () => {
    try {
      const result = await handleUpdateCache();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

// --- Branch merge/rebase ---

server.tool(
  'branch-merge',
  'Merge a source branch into a target branch across all repos in a workspace',
  {
    workspace: z.string().describe('Name of the workspace'),
    sourceBranch: z.string().describe('Branch to merge from'),
    targetBranch: z.string().describe('Branch to merge into'),
    strategy: z.enum(['no-ff', 'ff-only', 'squash']).optional().describe('Merge strategy'),
  },
  async ({ workspace, sourceBranch, targetBranch, strategy }) => {
    try {
      const result = await handleBranchMerge(workspace, sourceBranch, targetBranch, strategy);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'branch-rebase',
  'Rebase all repos in a workspace onto a target branch',
  {
    workspace: z.string().describe('Name of the workspace'),
    targetBranch: z.string().describe('Branch to rebase onto'),
  },
  async ({ workspace, targetBranch }) => {
    try {
      const result = await handleBranchRebase(workspace, targetBranch);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

// --- Suite operations ---

server.tool(
  'suite-create',
  'Create a new suite (reusable collection of repositories)',
  {
    name: z.string().describe('Name for the new suite'),
    repos: z.array(z.string()).describe('Array of repository names to include'),
    description: z.string().optional().describe('Optional description of the suite'),
  },
  async ({ name, repos, description }) => {
    try {
      const result = await handleSuiteCreate(name, repos, description);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'suite-delete',
  'Delete a saved suite',
  {
    name: z.string().describe('Name of the suite to delete'),
  },
  async ({ name }) => {
    try {
      const result = await handleSuiteDelete(name);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'suite-export',
  'Export suite(s) as JSON. Omit name to export all suites.',
  {
    name: z.string().optional().describe('Name of a specific suite to export (omit for all)'),
  },
  async ({ name }) => {
    try {
      const result = await handleSuiteExport(name);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'suite-import',
  'Import suites from a JSON string (same format as suite-export output)',
  {
    content: z.string().describe('JSON string containing suites to import'),
    overwrite: z.boolean().optional().default(false).describe('Overwrite existing suites with same name'),
  },
  async ({ content, overwrite }) => {
    try {
      const result = await handleSuiteImport(content, overwrite);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'suite-use',
  'Create a new workspace from a saved suite',
  {
    suite: z.string().describe('Name of the suite to use'),
    workspace: z.string().describe('Name for the new workspace to create'),
  },
  async ({ suite, workspace }) => {
    try {
      const result = await handleSuiteUse(suite, workspace);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

server.tool(
  'save-context',
  'Save a progress summary to the workspace. Use this to persist important context that should survive /clear or session restarts. The content is saved to CONTEXT.md in the workspace root.',
  {
    workspace: z.string().describe('Name of the workspace'),
    content: z.string().describe('The progress summary or context to save (markdown supported)'),
    append: z.boolean().optional().describe('Append to existing context instead of replacing (default: false)'),
  },
  async ({ workspace, content, append }) => {
    try {
      const result = await handleSaveContext(workspace, content, append);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('workspace-manager MCP server started\n');
}

main().catch((error) => {
  process.stderr.write(`MCP server error: ${error}\n`);
  process.exit(1);
});
