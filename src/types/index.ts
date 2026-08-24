export interface GitHubRepo {
  name: string;
  url: string;
  sshUrl: string;
  owner: {
    login: string;
  };
  description: string;
  isPrivate: boolean;
}

export interface CloneResult {
  repo: GitHubRepo;
  directoryName: string;
  status: 'success' | 'failed';
  error?: string;
  clonedAt?: string;
}

export interface CloneProgress {
  total: number;
  completed: number;
  current: string;
}

export interface RepositoryMetadata {
  name: string;
  directoryName: string;
  owner: string;
  clonedAt: string;
  cloneUrl: string;
  status: 'success' | 'failed';
  error?: string;
  // Enhanced tracking
  lastSynced?: string;
  lastBranchSwitch?: string;
  lastHealthCheck?: string;
  healthStatus?: 'healthy' | 'warning' | 'error';
}

export interface DependencyInfo {
  dependsOn: string[];
  dependedBy: string[];
  lastAnalyzed: string;
}

export interface WorkspaceMetadata {
  workspaceName: string;
  createdAt: string;
  lastModified?: string;
  repositories: RepositoryMetadata[];
  // Original prompt used to create the workspace (from 'w -- <prompt>')
  prompt?: string;
  // Dependency information
  dependencies?: {
    [repoName: string]: DependencyInfo;
  };
  // Custom metadata
  tags?: string[];
  description?: string;
  // Archive support
  archivedAt?: string;
}

export interface HealthCheckResult {
  category: string;
  status: 'healthy' | 'warning' | 'error';
  message: string;
  details?: string;
  actionable?: string;
}

export interface GitStatus {
  repo: string;
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  modifiedFiles: number;
  untrackedFiles: number;
  hasRemote: boolean;
  detachedHead: boolean;
}

export interface SuiteEntry {
  repoName: string;
  directoryName: string;
}

export interface PostCloneHook {
  repoName?: string;       // If omitted, runs for all repos
  commands: string[];       // Run sequentially in repo dir
  description?: string;
  continueOnError?: boolean; // Default false
}

export interface WorkspaceSuite {
  name: string;
  description: string;
  entries: SuiteEntry[];
  createdAt: string;
  updatedAt: string;
  postCloneHooks?: PostCloneHook[];
}

export interface SuitesStore {
  version: 1;
  suites: WorkspaceSuite[];
}
