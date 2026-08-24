import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceMetadata } from '../types';
import { generateMermaidDiagram } from './dependency-analyzer';
import * as markdownTable from 'markdown-table';

export const generateWorkspaceReadme = async (
  metadata: WorkspaceMetadata,
  workspacePath: string
): Promise<string> => {
  const lines: string[] = [];

  lines.push(`# ${metadata.workspaceName}`);
  lines.push('');

  if (metadata.description) {
    lines.push(metadata.description);
    lines.push('');
  }

  lines.push('## Overview');
  lines.push('');
  lines.push(`- **Created:** ${new Date(metadata.createdAt).toLocaleString()}`);
  if (metadata.lastModified) {
    lines.push(`- **Last Modified:** ${new Date(metadata.lastModified).toLocaleString()}`);
  }
  lines.push(`- **Repositories:** ${metadata.repositories.length}`);
  lines.push('');

  lines.push('## Repositories');
  lines.push('');

  const tableData: string[][] = [
    ['Repository', 'Owner', 'Cloned At', 'Status'],
  ];

  for (const repo of metadata.repositories) {
    tableData.push([
      repo.name,
      repo.owner,
      new Date(repo.clonedAt).toLocaleDateString(),
      repo.status === 'success' ? '✓' : '✗',
    ]);
  }

  // Simple table generation without markdown-table for now
  for (const row of tableData) {
    lines.push('| ' + row.join(' | ') + ' |');
    if (tableData.indexOf(row) === 0) {
      lines.push('| ' + row.map(() => '---').join(' | ') + ' |');
    }
  }
  lines.push('');

  lines.push('## Quick Start');
  lines.push('');
  lines.push('```bash');
  lines.push(`# Navigate to workspace`);
  lines.push(`wgo ${metadata.workspaceName}`);
  lines.push('');
  lines.push('# Check status');
  lines.push(`workspace status ${metadata.workspaceName}`);
  lines.push('');
  lines.push('# Sync all repositories');
  lines.push(`workspace sync ${metadata.workspaceName}`);
  lines.push('```');
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push('- `workspace status` - Check git status across all repos');
  lines.push('- `workspace doctor` - Run health checks');
  lines.push('- `workspace sync` - Pull latest changes');
  lines.push('- `workspace switch-branch` - Switch all repos to a branch');
  lines.push('- `workspace analyze-deps` - Analyze dependencies');
  lines.push('');

  return lines.join('\n');
};

export const generateDependencyGraph = (metadata: WorkspaceMetadata): string => {
  const lines: string[] = [];

  lines.push('# Dependency Graph');
  lines.push('');

  if (metadata.dependencies) {
    const analyses = new Map();

    for (const [repoName, depInfo] of Object.entries(metadata.dependencies)) {
      analyses.set(repoName, {
        repoName,
        dependencies: depInfo.dependsOn,
        dependents: depInfo.dependedBy,
        missingDependencies: [],
      });
    }

    const diagram = generateMermaidDiagram(analyses);
    lines.push(diagram);
  } else {
    lines.push('No dependency analysis available. Run `workspace analyze-deps` to generate.');
  }

  lines.push('');
  lines.push('## Dependency Details');
  lines.push('');

  if (metadata.dependencies) {
    for (const [repoName, depInfo] of Object.entries(metadata.dependencies)) {
      lines.push(`### ${repoName}`);
      lines.push('');

      if (depInfo.dependsOn.length > 0) {
        lines.push(`**Depends on:** ${depInfo.dependsOn.join(', ')}`);
        lines.push('');
      }

      if (depInfo.dependedBy.length > 0) {
        lines.push(`**Depended by:** ${depInfo.dependedBy.join(', ')}`);
        lines.push('');
      }

      if (depInfo.dependsOn.length === 0 && depInfo.dependedBy.length === 0) {
        lines.push('No dependencies');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
};

export const generateRepositoryIndex = async (
  metadata: WorkspaceMetadata,
  workspacePath: string
): Promise<string> => {
  const lines: string[] = [];

  lines.push('# Repository Index');
  lines.push('');

  for (const repo of metadata.repositories) {
    const repoPath = path.join(workspacePath, repo.name);

    lines.push(`## ${repo.name}`);
    lines.push('');
    lines.push(`- **Owner:** ${repo.owner}`);
    lines.push(`- **Clone URL:** ${repo.cloneUrl}`);
    lines.push(`- **Cloned At:** ${new Date(repo.clonedAt).toLocaleString()}`);

    // Try to read package.json for tech stack info
    try {
      const packageJsonPath = path.join(repoPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.description) {
        lines.push(`- **Description:** ${packageJson.description}`);
      }

      if (packageJson.scripts) {
        const scripts = Object.keys(packageJson.scripts).slice(0, 5);
        lines.push(`- **Scripts:** ${scripts.join(', ')}`);
      }
    } catch {
      // No package.json or can't read
    }

    lines.push('');
  }

  return lines.join('\n');
};

export const writeDocs = async (
  workspacePath: string,
  metadata: WorkspaceMetadata
): Promise<void> => {
  const readme = await generateWorkspaceReadme(metadata, workspacePath);
  await fs.writeFile(path.join(workspacePath, 'WORKSPACE-README.md'), readme, 'utf-8');

  const depGraph = generateDependencyGraph(metadata);
  await fs.writeFile(path.join(workspacePath, 'DEPENDENCY-GRAPH.md'), depGraph, 'utf-8');

  const repoIndex = await generateRepositoryIndex(metadata, workspacePath);
  await fs.writeFile(path.join(workspacePath, 'REPOSITORY-INDEX.md'), repoIndex, 'utf-8');
};
