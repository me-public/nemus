/**
 * @nemus-cli/cloud — optional, vendor-neutral cloud/IaC runners for Nemus.
 *
 * This is a scaffold. The first concrete piece is the forge-auth seam
 * (`ForgeTokenSource`) with `pat` and `github-app` sources. Runners,
 * Provisioners, GitForge and the Target Descriptor land in later phases —
 * see docs/plans/2026-08-26-cloud-iac.md.
 */

export * from './forge/types';
export { PatTokenSource } from './forge/pat';
export { GitHubAppTokenSource, mintAppJwt } from './forge/github-app';
export type { GitHubAppConfig } from './forge/github-app';

// Execution seam: Runner/Provisioner interfaces + the in-box Docker runner.
export * from './runner/types';
export { DockerRunner } from './runner/docker';
export type { DockerRunnerOptions, CommandRunner, LogStreamer } from './runner/docker';
export { FargateRunner, mapFargateState } from './runner/fargate';
export type { FargateRunnerOptions } from './runner/fargate';
export { createRunner, registerRunner, runnerNames } from './runner/registry';
export type { RunnerFactory } from './runner/registry';

// Secret-resolution seam: turn TaskSpec.secrets into env for storeless backends.
export * from './secret';

// Code-host seam: open PR / read checks / comment.
export * from './gitforge/types';
export { GitHubForge } from './gitforge/github';
export type { GitHubForgeOptions } from './gitforge/github';
export { GitLabForge } from './gitforge/gitlab';
export type { GitLabForgeOptions } from './gitforge/gitlab';
// Code-host registry: build a GitForge by kind (github | gitlab | custom).
export {
  createForge,
  registerForge,
  registeredForges,
  forgeKindFromEnv,
  forgeApiBaseFromEnv,
} from './gitforge/registry';
export type { ForgeKind, ForgeFactory, CreateForgeOptions } from './gitforge/registry';

// In-image agent orchestrator: env contract, result.json schema, run flow.
export * from './agent/types';
export { parseAgentEnv, parseRepo } from './agent/env';
export { runAgentTask, slug } from './agent/run';
export type { RunAgentDeps } from './agent/run';
// fix-pr entry mode: drive an existing PR to green (CI-loop + notifications).
export { runFixPr, parseFixPrEnv } from './agent/fix-pr';
export type { FixPrConfig, FixPrDeps } from './agent/fix-pr';
export { ShellGitOps } from './agent/git-ops';
export type { ShellGitOpsOptions } from './agent/git-ops';
export { ShellAgentInvoker, buildAgentCommand } from './agent/agent-invoker';
export { shellExec, run as runCommand } from './agent/exec';
export type { Exec } from './agent/exec';

// Provisioning seam: one generic OpenTofu/Terraform provisioner, many modules.
export { OpenTofuProvisioner, parseTargetDescriptor } from './provision/opentofu';
export type { OpenTofuProvisionerOptions } from './provision/opentofu';
export { createProvisioner, registerProvisioner, provisionerNames } from './provision/registry';
export type { ProvisionerFactory } from './provision/registry';
export { iacModuleDir } from './provision/modules';

// Bounded CI-loop: drive a PR to green over GitForge (report-back + fix, P3).
export { runCiLoop } from './ci/loop';
export { summarizeChecks, buildFixPrompt } from './ci/checks';
export type { ChecksSummary } from './ci/checks';
export type { CiLoopConfig, CiLoopDeps, CiLoopResult, CiLoopState } from './ci/types';

// Notification seam: out-of-band report-back (Slack / generic webhook), P4.
export * from './notify';
export { notifierFromEnv } from './notify';

import { ForgeTokenSource } from './forge/types';
import { PatTokenSource } from './forge/pat';
import { GitHubAppTokenSource, GitHubAppConfig } from './forge/github-app';

export interface ForgeAuthConfig {
  /** Which source to use. Defaults to 'github-app' if `app` is set, else 'pat'. */
  forge?: 'pat' | 'github-app' | (string & {});
  /** For 'pat'. */
  token?: string;
  /** For 'github-app'. */
  app?: GitHubAppConfig;
}

/**
 * Resolve a `ForgeTokenSource` from generic config. Placement of the App private
 * key (client-side / in-task / broker) is orthogonal to this wiring — this only
 * decides *which* source, not *where* it runs.
 */
export function createForgeTokenSource(cfg: ForgeAuthConfig): ForgeTokenSource {
  const forge = cfg.forge ?? (cfg.app ? 'github-app' : 'pat');
  switch (forge) {
    case 'pat':
      if (!cfg.token) throw new Error('forge "pat": token is required');
      return new PatTokenSource(cfg.token);
    case 'github-app':
      if (!cfg.app) throw new Error('forge "github-app": app config is required');
      return new GitHubAppTokenSource(cfg.app);
    default:
      throw new Error(`unknown forge "${forge}" (built-ins: pat, github-app)`);
  }
}

/**
 * Resolve a `ForgeTokenSource` from environment variables — the convention the
 * runner image uses:
 *   NEMUS_FORGE=github-app  GITHUB_APP_ID  GITHUB_APP_PRIVATE_KEY
 *                           [GITHUB_APP_INSTALLATION_ID] [GITHUB_APP_OWNER]
 *   NEMUS_FORGE=pat         GITHUB_TOKEN | GIT_TOKEN
 */
export function forgeAuthFromEnv(env: NodeJS.ProcessEnv = process.env): ForgeTokenSource {
  const forge = env.NEMUS_FORGE;
  if (forge === 'github-app' || (!forge && env.GITHUB_APP_ID)) {
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      throw new Error('forge "github-app": GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
    }
    return new GitHubAppTokenSource({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
      owner: env.GITHUB_APP_OWNER ?? env.NEMUS_GIT_OWNER,
      apiBaseUrl: env.GITHUB_API_URL,
    });
  }
  const token = env.GIT_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('no forge auth: set GITHUB_TOKEN/GIT_TOKEN, or GITHUB_APP_* for App auth');
  }
  return new PatTokenSource(token);
}
