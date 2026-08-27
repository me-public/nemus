import { Command } from 'commander';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata, saveMetadata } from '../utils/workspace-meta';
import {
  analyzeDependencies,
  detectCircularDependencies,
  generateMermaidDiagram,
  updateWorkspaceMetadata,
} from '../utils/dependency-analyzer';
import { logError, logInfo, logStep, logSuccess } from '../utils/logger';
import { outputJson, outputJsonError } from '../utils/output';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import { resolveWorkspace } from '../utils/command-helpers';

const displayDependencyAnalysis = (analyses: Map<string, any>) => {
  console.log('\n' + colorize('Dependency Analysis', 'bright'));
  console.log(colorize('═'.repeat(100), 'gray'));

  for (const [repoName, analysis] of analyses) {
    console.log(`\n${colorize(repoName, 'cyan')}`);
    if (analysis.dependencies.length > 0) {
      console.log(`  ${colorize('Depends on:', 'gray')} ${analysis.dependencies.join(', ')}`);
    }
    if (analysis.dependents.length > 0) {
      console.log(`  ${colorize('Depended by:', 'gray')} ${analysis.dependents.join(', ')}`);
    }
    if (analysis.missingDependencies.length > 0) {
      console.log(`  ${colorize('⚠ Missing deps:', 'yellow')} ${analysis.missingDependencies.join(', ')}`);
    }
    if (analysis.dependencies.length === 0 && analysis.dependents.length === 0 && analysis.missingDependencies.length === 0) {
      console.log(`  ${colorize('No dependencies detected', 'gray')}`);
    }
  }

  console.log('\n' + colorize('═'.repeat(100), 'gray'));
};

export function registerAnalyzeDepsCommand(parent: Command) {
  parent
    .command('analyze-deps')
    .alias('ad')
    .description('Analyze inter-repo dependencies')
    .argument('[workspace]', 'Workspace name')
    .option('--json', 'Output as JSON (no interactive save)')
    .action(async (workspace, opts) => {
      await handleAnalyzeDeps(workspace, opts);
    });
}

async function handleAnalyzeDeps(workspaceArg?: string, opts: { json?: boolean } = {}) {
  try {
    // JSON mode is non-interactive: require an explicit workspace rather than prompt.
    if (opts.json && !workspaceArg) {
      outputJsonError('analyze-deps --json requires a workspace name');
      process.exit(1);
    }
    const selectedWorkspace = await resolveWorkspace(workspaceArg);
    const workspacePath = path.join(WORKSPACES_DIR, selectedWorkspace);
    const metadata = await loadMetadata(workspacePath);

    if (!metadata) {
      if (opts.json) outputJsonError(`Workspace metadata not found for: ${selectedWorkspace}`);
      else logError(`Workspace metadata not found for: ${selectedWorkspace}`);
      process.exit(1);
    }

    const repoNames = metadata.repositories.map(r => r.name);

    if (opts.json) {
      const analyses = await analyzeDependencies(workspacePath, repoNames);
      const cycles = detectCircularDependencies(analyses);
      const missing = new Set<string>();
      for (const [, a] of analyses) for (const dep of a.missingDependencies) missing.add(dep);
      outputJson({
        workspace: selectedWorkspace,
        repositories: Array.from(analyses.entries()).map(([name, a]) => ({
          name,
          dependencies: a.dependencies,
          dependents: a.dependents,
          missingDependencies: a.missingDependencies,
        })),
        circularDependencies: cycles,
        missingRepositories: Array.from(missing),
      });
      return;
    }

    logStep(`Analyzing dependencies for workspace: ${colorize(selectedWorkspace, 'cyan')}`);
    logInfo('Scanning package.json, Dockerfile, and docker-compose.yml files...');

    const analyses = await analyzeDependencies(workspacePath, repoNames);

    displayDependencyAnalysis(analyses);

    const cycles = detectCircularDependencies(analyses);
    if (cycles.length > 0) {
      console.log('\n' + colorize('⚠ Circular Dependencies Detected:', 'yellow'));
      for (const cycle of cycles) {
        console.log(`  ${cycle.join(' → ')}`);
      }
    }

    const diagram = generateMermaidDiagram(analyses);
    console.log('\n' + colorize('Dependency Graph (Mermaid):', 'bright'));
    console.log(diagram);

    const missingDeps = new Set<string>();
    for (const [, analysis] of analyses) {
      for (const dep of analysis.missingDependencies) {
        missingDeps.add(dep);
      }
    }

    if (missingDeps.size > 0) {
      console.log('\n' + colorize('💡 Suggested Missing Repositories:', 'yellow'));
      for (const dep of missingDeps) {
        console.log(`  • ${dep}`);
      }
      logInfo(`Consider adding these repositories with: workspace update ${selectedWorkspace}`);
    }

    if (process.stdout.isTTY) {
      const { saveToMetadata } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveToMetadata',
          message: 'Save dependency analysis to workspace metadata?',
          default: true,
        },
      ]);

      if (saveToMetadata) {
        const updatedMetadata = updateWorkspaceMetadata(metadata, analyses);
        await saveMetadata(workspacePath, updatedMetadata);
        logSuccess('Dependency analysis saved to metadata');
      }
    }
  } catch (error) {
    if (opts.json) {
      outputJsonError(error instanceof Error ? error.message : 'Failed to analyze dependencies');
    } else {
      logError('Failed to analyze dependencies');
      if (error instanceof Error) logError(error.message);
    }
    process.exit(1);
  }
}
