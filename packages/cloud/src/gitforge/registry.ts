import { ForgeTokenSource } from '../forge/types';
import { GitForge } from './types';
import { GitHubForge } from './github';
import { GitLabForge } from './gitlab';

/** Built-in code-host kinds. Extend by registering your own (see README). */
export type ForgeKind = 'github' | 'gitlab';

export interface CreateForgeOptions {
  tokenSource: ForgeTokenSource;
  /** Host API base (GHES / self-managed GitLab). Defaults per kind. */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Signature every forge factory (built-in or custom) satisfies. */
export type ForgeFactory = (opts: CreateForgeOptions) => GitForge;

const registry: Record<string, ForgeFactory> = {
  github: (o) => new GitHubForge(o),
  gitlab: (o) => new GitLabForge(o),
};

/**
 * Register a custom GitForge implementation under a kind name, so
 * `createForge('<kind>', …)` and `NEMUS_FORGE_HOST=<kind>` resolve it. Lets a
 * downstream user bring their own backend (Gitea, Bitbucket, …) without
 * forking. Overriding a built-in name is allowed (last write wins).
 */
export function registerForge(kind: string, factory: ForgeFactory): void {
  registry[kind] = factory;
}

/** Names of all registered forges (built-ins + any custom). */
export function registeredForges(): string[] {
  return Object.keys(registry);
}

/**
 * Construct a GitForge by kind. The seam every caller should use instead of
 * `new GitHubForge(...)`, so a workspace can target GitHub or GitLab (or a
 * custom host) with no code change.
 */
export function createForge(kind: string, opts: CreateForgeOptions): GitForge {
  const factory = registry[kind];
  if (!factory) {
    throw new Error(
      `unknown forge host "${kind}" (known: ${registeredForges().join(', ')})`,
    );
  }
  return factory(opts);
}

/**
 * Resolve the code-host kind from the environment. `NEMUS_FORGE_HOST` selects
 * it (default `github`); note this is the *code host*, distinct from
 * `NEMUS_FORGE`, which selects the token source (pat | github-app).
 */
export function forgeKindFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEMUS_FORGE_HOST?.trim() || 'github';
}

/**
 * Per-kind default for the host API base, honoring the host-specific env var
 * (`GITHUB_API_URL` / `GITLAB_API_URL`). Returns undefined when unset, so each
 * forge falls back to its own public default.
 */
export function forgeApiBaseFromEnv(
  kind: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (kind === 'gitlab') return env.GITLAB_API_URL?.trim() || undefined;
  return env.GITHUB_API_URL?.trim() || undefined;
}
