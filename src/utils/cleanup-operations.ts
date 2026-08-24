import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface CleanupResult {
  operation: string;
  filesRemoved: number;
  spaceFreed: string;
  success: boolean;
}

export const calculateDirSize = async (dirPath: string): Promise<number> => {
  try {
    const { stdout } = await execAsync(`du -sk "${dirPath}"`);
    const sizeInKB = parseInt(stdout.split('\t')[0], 10);
    return sizeInKB;
  } catch {
    return 0;
  }
};

export const removeNodeModules = async (repoPath: string): Promise<CleanupResult> => {
  const nodeModulesPath = path.join(repoPath, 'node_modules');

  try {
    const sizeBefore = await calculateDirSize(nodeModulesPath);
    await fs.rm(nodeModulesPath, { recursive: true, force: true });

    return {
      operation: 'Remove node_modules',
      filesRemoved: 1,
      spaceFreed: `${(sizeBefore / 1024).toFixed(2)} MB`,
      success: true,
    };
  } catch (error) {
    return {
      operation: 'Remove node_modules',
      filesRemoved: 0,
      spaceFreed: '0 MB',
      success: false,
    };
  }
};

export const removeBuildArtifacts = async (repoPath: string): Promise<CleanupResult> => {
  const artifacts = ['dist', 'build', '.next', 'coverage', 'out'];
  let totalSize = 0;
  let removed = 0;

  for (const artifact of artifacts) {
    const artifactPath = path.join(repoPath, artifact);
    try {
      const size = await calculateDirSize(artifactPath);
      await fs.rm(artifactPath, { recursive: true, force: true });
      totalSize += size;
      removed++;
    } catch {
      // Ignore if doesn't exist
    }
  }

  return {
    operation: 'Remove build artifacts',
    filesRemoved: removed,
    spaceFreed: `${(totalSize / 1024).toFixed(2)} MB`,
    success: true,
  };
};

export const gitClean = async (repoPath: string, dryRun: boolean = false): Promise<CleanupResult> => {
  try {
    const cmd = dryRun ? 'git clean -fdxn' : 'git clean -fdx';
    const { stdout } = await execAsync(cmd, { cwd: repoPath });

    const lines = stdout.split('\n').filter(l => l.trim());

    return {
      operation: 'Git clean',
      filesRemoved: lines.length,
      spaceFreed: 'Unknown',
      success: true,
    };
  } catch {
    return {
      operation: 'Git clean',
      filesRemoved: 0,
      spaceFreed: '0 MB',
      success: false,
    };
  }
};
