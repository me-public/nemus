import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata } from '../utils/workspace-meta';
import { writeDocs } from '../utils/doc-generator';
import { logError, logStep, logSuccess } from '../utils/logger';
import { colorize } from '../utils/colors';
import { resolveWorkspace } from '../utils/command-helpers';

export function registerGenerateDocsCommand(parent: Command) {
  parent
    .command('generate-docs')
    .alias('gd')
    .description('Generate workspace documentation')
    .argument('[workspace]', 'Workspace name')
    .action(async (workspace) => {
      await handleGenerateDocs(workspace);
    });
}

async function handleGenerateDocs(workspaceArg?: string) {
  try {
    const workspaceName = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      logError(`Workspace not found: ${workspaceName}`);
      process.exit(1);
    }

    logStep(`Generating documentation for ${colorize(workspaceName, 'cyan')}...`);

    await writeDocs(workspacePath, metadata);

    logSuccess('Documentation generated:');
    console.log(`  • WORKSPACE-README.md`);
    console.log(`  • DEPENDENCY-GRAPH.md`);
    console.log(`  • REPOSITORY-INDEX.md`);
  } catch (error) {
    logError('Failed to generate documentation');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
