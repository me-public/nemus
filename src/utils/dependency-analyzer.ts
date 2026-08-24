import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceMetadata, DependencyInfo } from '../types';
import { getUserConfig } from './config';

export interface DependencyAnalysis {
  repoName: string;
  dependencies: string[];
  dependents: string[];
  missingDependencies: string[];
}

export const analyzePackageJson = async (repoPath: string): Promise<string[]> => {
  try {
    const packageJsonPath = path.join(repoPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const dependencies: string[] = [];

    // Check dependencies and devDependencies
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const { githubOrg } = getUserConfig();
    const scopePrefix = githubOrg ? `@${githubOrg}/` : '';
    for (const dep of Object.keys(allDeps)) {
      // Match packages under the configured org scope (e.g. @your-org/*), or any
      // scoped package as a fallback so cross-repo links are still detected.
      if (dep.startsWith('@')) {
        dependencies.push(
          scopePrefix && dep.startsWith(scopePrefix)
            ? dep.slice(scopePrefix.length)
            : dep.replace(/^@[^/]+\//, '').replace('@', '')
        );
      }
    }

    return dependencies;
  } catch {
    return [];
  }
};

export const analyzeImports = async (repoPath: string): Promise<string[]> => {
  try {
    const dependencies: Set<string> = new Set();

    // Scan source files for relative imports that might indicate dependencies
    const scanDirs = ['src', 'lib', 'app'];

    for (const dir of scanDirs) {
      const dirPath = path.join(repoPath, dir);
      try {
        await fs.access(dirPath);
        // For simplicity, we're not doing deep file scanning here
        // In a real implementation, you'd recursively read .ts, .js, .tsx files
      } catch {
        continue;
      }
    }

    return Array.from(dependencies);
  } catch {
    return [];
  }
};

export const analyzeDockerfile = async (repoPath: string): Promise<string[]> => {
  try {
    const dockerfilePath = path.join(repoPath, 'Dockerfile');
    const content = await fs.readFile(dockerfilePath, 'utf-8');

    const dependencies: string[] = [];
    const fromRegex = /FROM\s+([^\s]+)/g;
    let match;

    while ((match = fromRegex.exec(content)) !== null) {
      const image = match[1];
      // Extract potential dependency references to other org images. When an org
      // is configured, treat images named after it (e.g. `your-org-foo`) as deps.
      const { githubOrg } = getUserConfig();
      if (githubOrg && image.includes(githubOrg)) {
        dependencies.push(image.split(':')[0].replace(`${githubOrg}-`, ''));
      }
    }

    return dependencies;
  } catch {
    return [];
  }
};

export const analyzeDockerCompose = async (repoPath: string): Promise<string[]> => {
  try {
    const composePath = path.join(repoPath, 'docker-compose.yml');
    const content = await fs.readFile(composePath, 'utf-8');

    const dependencies: string[] = [];

    // Simple pattern matching for service references
    const serviceRegex = /depends_on:\s*\n((?:\s+-\s+\w+\n)+)/g;
    let match;

    while ((match = serviceRegex.exec(content)) !== null) {
      const services = match[1].match(/\w+/g);
      if (services) {
        dependencies.push(...services);
      }
    }

    return dependencies;
  } catch {
    return [];
  }
};

export const analyzeDependencies = async (
  workspacePath: string,
  repoNames: string[]
): Promise<Map<string, DependencyAnalysis>> => {
  const analyses = new Map<string, DependencyAnalysis>();

  for (const repoName of repoNames) {
    const repoPath = path.join(workspacePath, repoName);

    const [packageDeps, dockerDeps, composeDeps] = await Promise.all([
      analyzePackageJson(repoPath),
      analyzeDockerfile(repoPath),
      analyzeDockerCompose(repoPath),
    ]);

    const allDeps = [...new Set([...packageDeps, ...dockerDeps, ...composeDeps])];

    // Filter to only dependencies that are in the workspace
    const validDeps = allDeps.filter(dep => repoNames.includes(dep));

    // Find missing dependencies (referenced but not in workspace)
    const missingDeps = allDeps.filter(dep => !repoNames.includes(dep));

    analyses.set(repoName, {
      repoName,
      dependencies: validDeps,
      dependents: [], // Will be filled in next pass
      missingDependencies: missingDeps,
    });
  }

  // Build dependents lists
  for (const [repoName, analysis] of analyses) {
    for (const dep of analysis.dependencies) {
      const depAnalysis = analyses.get(dep);
      if (depAnalysis && !depAnalysis.dependents.includes(repoName)) {
        depAnalysis.dependents.push(repoName);
      }
    }
  }

  return analyses;
};

export const detectCircularDependencies = (
  analyses: Map<string, DependencyAnalysis>
): string[][] => {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  const dfs = (repo: string, path: string[]): void => {
    visited.add(repo);
    recursionStack.add(repo);
    path.push(repo);

    const analysis = analyses.get(repo);
    if (analysis) {
      for (const dep of analysis.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep, [...path]);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = path.slice(cycleStart);
          cycle.push(dep);
          cycles.push(cycle);
        }
      }
    }

    recursionStack.delete(repo);
  };

  for (const repoName of analyses.keys()) {
    if (!visited.has(repoName)) {
      dfs(repoName, []);
    }
  }

  return cycles;
};

export const generateMermaidDiagram = (analyses: Map<string, DependencyAnalysis>): string => {
  const lines = ['```mermaid', 'graph TD'];

  for (const [repoName, analysis] of analyses) {
    const nodeId = repoName.replace(/[^a-zA-Z0-9]/g, '_');

    for (const dep of analysis.dependencies) {
      const depId = dep.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`  ${nodeId}[${repoName}] --> ${depId}[${dep}]`);
    }

    // Add standalone nodes (no dependencies)
    if (analysis.dependencies.length === 0 && analysis.dependents.length === 0) {
      lines.push(`  ${nodeId}[${repoName}]`);
    }
  }

  lines.push('```');
  return lines.join('\n');
};

export const updateWorkspaceMetadata = (
  metadata: WorkspaceMetadata,
  analyses: Map<string, DependencyAnalysis>
): WorkspaceMetadata => {
  const dependencies: { [repoName: string]: DependencyInfo } = {};

  for (const [repoName, analysis] of analyses) {
    dependencies[repoName] = {
      dependsOn: analysis.dependencies,
      dependedBy: analysis.dependents,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  return {
    ...metadata,
    dependencies,
    lastModified: new Date().toISOString(),
  };
};
