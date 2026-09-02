import { Command } from 'commander';
import * as fs from 'fs/promises';
import { safeWorkspacePath } from '../utils/validation';
import { listWorkspaces } from '../utils/workspace-meta';
import { getWorkspaceSessions } from '../utils/claude-sessions';
import { getAllReposStatus } from '../utils/git-status';
import { logInfo, logSuccess, logError, logWarning, logStep } from '../utils/logger';
import { colorize } from '../utils/colors';
import { confirm } from '../utils/prompt';
import { getGlobalOpts } from '../utils/command-helpers';
import { outputJson, outputJsonError } from '../utils/output';
import {
  toCandidate,
  isStale,
  planPrune,
  type WorkspaceForPrune,
  type PruneCandidate,
} from '../utils/prune';

const DEFAULT_DAYS = 30;

export function registerPruneCommand(parent: Command) {
  parent
    .command('prune')
    .description('Delete workspaces with no recent activity (safe by default)')
    .option('-d, --days <n>', `Consider a workspace stale after N days of inactivity (default ${DEFAULT_DAYS})`)
    .option('--include-dirty', 'Also prune workspaces with uncommitted/unpushed changes (default: protected)')
    .option('--dry-run', 'Show what would be pruned without deleting anything')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output the prune plan as JSON (never deletes)')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handlePrune({ ...opts, ...globalOpts });
    });
}

function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export async function handlePrune(opts: {
  days?: string;
  includeDirty?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}) {
  const json = !!opts.json;
  const days = parseDays(opts.days);
  if (days === null) {
    if (json) outputJsonError('--days must be a non-negative number');
    else logError('--days must be a non-negative number');
    process.exit(1);
  }

  try {
    const [workspaces, sessions] = await Promise.all([listWorkspaces(), getWorkspaceSessions()]);
    const sessionMap = new Map(sessions.map((s) => [s.workspaceName, s]));
    const now = Date.now();

    const candidates: PruneCandidate[] = workspaces.map((ws) => {
      const session = sessionMap.get(ws.name);
      const createdRaw = ws.metadata?.createdAt ? Date.parse(ws.metadata.createdAt) : NaN;
      const forPrune: WorkspaceForPrune = {
        name: ws.name,
        path: ws.path,
        repoDirNames: (ws.metadata?.repositories ?? []).map((r) => r.directoryName),
        lastActiveAt: session ? session.lastActiveAt.getTime() : 0,
        createdAt: Number.isFinite(createdRaw) ? createdRaw : 0,
      };
      return toCandidate(forPrune, now);
    });

    const stale = candidates.filter((c) => isStale(c, days));

    if (stale.length === 0) {
      if (json) {
        outputJson({ ok: true, days, prunable: [], protected: [], scanned: workspaces.length });
      } else {
        logInfo(`No workspaces inactive for ${days}+ days (scanned ${workspaces.length}).`);
      }
      return;
    }

    // Compute the plan. The git safety check only runs for stale workspaces.
    const plan = await planPrune(
      stale,
      (c) => getAllReposStatus(c.path, c.repoDirNames, 3),
      !!opts.includeDirty,
    );

    if (json) {
      outputJson({
        ok: true,
        days,
        scanned: workspaces.length,
        prunable: plan.prunable.map((c) => ({ name: c.name, path: c.path, ageDays: c.ageDays, repos: c.repoDirNames.length })),
        protected: plan.protected.map((p) => ({ name: p.candidate.name, ageDays: p.candidate.ageDays, reason: p.reason })),
      });
      return;
    }

    // Human report.
    console.log('\n' + '='.repeat(60));
    console.log(colorize(`Prune — workspaces inactive for ${days}+ days`, 'bright'));
    console.log('='.repeat(60) + '\n');

    if (plan.protected.length > 0) {
      logWarning(`Protected (${plan.protected.length}) — skipped due to unsaved work:`);
      for (const p of plan.protected) {
        console.log(`  ${colorize('•', 'yellow')} ${colorize(p.candidate.name, 'cyan')} — ${p.reason} ${colorize(`(${ageLabel(p.candidate)})`, 'gray')}`);
      }
      console.log('');
    }

    if (plan.prunable.length === 0) {
      logInfo('Nothing safe to prune.');
      if (plan.protected.length > 0) logInfo('Re-run with --include-dirty to include the protected ones (careful).');
      return;
    }

    console.log(`${colorize('Prunable', 'bright')} (${plan.prunable.length}):`);
    for (const c of plan.prunable) {
      const repoLabel = c.repoDirNames.length === 1 ? '1 repo' : `${c.repoDirNames.length} repos`;
      console.log(`  ${colorize('✗', 'red')} ${colorize(c.name, 'cyan')} ${colorize(`(${ageLabel(c)}, ${repoLabel})`, 'gray')}`);
    }
    console.log('');

    if (opts.dryRun) {
      logInfo(`Dry run — nothing deleted. ${plan.prunable.length} workspace(s) would be pruned.`);
      return;
    }

    logWarning('This permanently deletes the selected workspaces and every cloned repo inside them!');

    if (!opts.yes) {
      const confirmed = await confirm({
        message: plan.prunable.length === 1
          ? `Prune workspace ${plan.prunable[0].name}?`
          : `Prune these ${plan.prunable.length} workspaces?`,
        default: false,
      });
      if (!confirmed) {
        logInfo('Prune cancelled');
        return;
      }
    }

    let deleted = 0;
    for (const c of plan.prunable) {
      let target: string;
      try {
        // Re-validate through the same choke point delete uses: enforces the
        // name allowlist and pins the path inside WORKSPACES_DIR.
        target = safeWorkspacePath(c.name);
      } catch (error) {
        logError(error instanceof Error ? error.message : `Invalid workspace name "${c.name}"`);
        continue;
      }
      try {
        await fs.rm(target, { recursive: true, force: true });
        logSuccess(`Pruned "${colorize(c.name, 'cyan')}"`);
        deleted++;
      } catch (error) {
        logError(`Failed to prune "${c.name}"`);
        if (error instanceof Error) logError(error.message);
      }
    }
    logStep(`Pruned ${deleted} of ${plan.prunable.length} workspace(s).`);
  } catch (error) {
    if (json) outputJsonError(error instanceof Error ? error.message : 'prune failed');
    else logError(error instanceof Error ? error.message : 'prune failed');
    process.exit(1);
  }
}

function ageLabel(c: PruneCandidate): string {
  const base = c.ageDays === 1 ? '1 day' : `${c.ageDays} days`;
  return c.fromSession ? `${base} since last session` : `${base} since created, no sessions`;
}
