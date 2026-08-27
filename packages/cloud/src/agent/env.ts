import { AgentRunConfig } from './types';

/**
 * The runner-image env contract. Kept small and explicit — this is what every
 * backend fills in when launching the agent image, so it's expensive to change.
 *
 *   NEMUS_REPOS     (required) csv of `owner/name` or bare `name`
 *   NEMUS_TASK      (required) the prompt for the agent
 *   NEMUS_AGENT     coding agent: pi (default) | claude | …
 *   NEMUS_OWNER     default owner for bare repo names (also GITHUB_ORG)
 *   GIT_HOST        default github.com
 *   NEMUS_BASE_BRANCH   default main
 *   NEMUS_BRANCH_PREFIX default nemus/
 *   NEMUS_WORKDIR   default /workspace
 *   REPORT_MODE     pr (default) | none
 *   NEMUS_PR_DRAFT  '0' to open non-draft PRs (default draft)
 */
export function parseAgentEnv(env: NodeJS.ProcessEnv = process.env): AgentRunConfig {
  const repos = (env.NEMUS_REPOS ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (repos.length === 0) throw new Error('NEMUS_REPOS is required (comma-separated repos)');

  const task = (env.NEMUS_TASK ?? '').trim();
  if (!task) throw new Error('NEMUS_TASK is required');

  const report = env.REPORT_MODE === 'none' ? 'none' : 'pr';
  if (env.REPORT_MODE && env.REPORT_MODE !== 'none' && env.REPORT_MODE !== 'pr') {
    throw new Error(`REPORT_MODE must be 'pr' or 'none', got '${env.REPORT_MODE}'`);
  }

  return {
    repos,
    task,
    agent: env.NEMUS_AGENT?.trim() || 'pi',
    gitHost: env.GIT_HOST?.trim() || 'github.com',
    owner: (env.NEMUS_OWNER || env.GITHUB_ORG || env.NEMUS_GIT_OWNER)?.trim() || undefined,
    baseBranch: env.NEMUS_BASE_BRANCH?.trim() || 'main',
    branchPrefix: env.NEMUS_BRANCH_PREFIX?.trim() || 'nemus/',
    workdir: env.NEMUS_WORKDIR?.trim() || '/workspace',
    report,
    draft: env.NEMUS_PR_DRAFT !== '0',
  };
}

/** Split `owner/name` or bare `name` (+ default owner) into parts. */
export function parseRepo(
  ref: string,
  defaultOwner?: string,
): { owner: string; name: string; full: string } {
  const trimmed = ref.trim().replace(/\.git$/, '');
  if (trimmed.includes('/')) {
    const [owner, name] = trimmed.split('/');
    return { owner, name, full: `${owner}/${name}` };
  }
  if (!defaultOwner) {
    throw new Error(`repo "${ref}" has no owner and no default owner (set NEMUS_OWNER/GITHUB_ORG)`);
  }
  return { owner: defaultOwner, name: trimmed, full: `${defaultOwner}/${trimmed}` };
}
