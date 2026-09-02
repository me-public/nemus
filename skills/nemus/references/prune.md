# Prune Inactive Workspaces

Bulk-delete workspaces with no recent activity. **Safe by default** — it holds
back any workspace with uncommitted or unpushed work.

1. **Always preview first.** Show the user exactly what would be deleted (and
   what is protected) before removing anything:
   ```bash
   nemus prune --days <n> --dry-run
   ```
   A workspace is *stale* when its most recent agent session — or, if it has no
   session, its `createdAt` — is older than `--days` (default 30). Workspaces
   with no date at all are never selected.

2. **Review the two lists.** `prune` prints:
   - **Protected** — stale workspaces skipped because a repo has uncommitted
     changes or unpushed commits (with the reason). These are NOT deleted.
   - **Prunable** — stale workspaces that are safe to remove.

3. **Confirm with the user, then prune.** This permanently deletes the
   workspace directories and every cloned repo inside them:
   ```bash
   nemus prune --days <n>          # prompts for confirmation (default: No)
   nemus prune --days <n> --yes    # non-interactive (only when the user is sure)
   ```

4. **`--json`** gives a machine-readable plan (`{ prunable, protected }`) and,
   like `--dry-run`, never deletes.

Deletions go through the same validated path as `nemus delete` (name allowlist +
path pinned inside the workspaces directory).

## Flags

| Flag | Short | Description |
|---|---|---|
| `--days <n>` | `-d` | Stale after N days of inactivity (default 30) |
| `--dry-run` | | Show the plan without deleting anything |
| `--json` | | Output the plan as JSON (never deletes) |
| `--yes` | `-y` | Skip the confirmation prompt |
| `--include-dirty` | | Also prune workspaces with uncommitted/unpushed work (overrides the safety guard — use with care) |

> **Only** pass `--include-dirty` when the user has explicitly accepted losing
> uncommitted/unpushed work in the protected workspaces.
