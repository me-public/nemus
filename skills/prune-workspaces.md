---
name: prune-workspaces
description: Bulk-delete workspaces with no recent activity, safe by default (protects uncommitted/unpushed work)
---

Preview first — never delete without showing the user the plan:
```bash
nemus prune --days 30 --dry-run
```

Then prune after confirming with the user:
```bash
nemus prune --days 30          # prompts (default: No)
nemus prune --days 30 --yes    # non-interactive — only when the user is sure
```

- **Stale** = no agent session (or, failing that, no `createdAt`) in the last N
  days (`--days`, default 30). Undatable workspaces are never selected.
- **Safe by default:** workspaces with uncommitted or unpushed changes are
  **protected** and listed with the reason — not deleted. `--include-dirty`
  overrides this (only with explicit user consent to lose that work).
- `--json` and `--dry-run` never delete.
- Deletion is permanent — repos must be re-cloned. Always confirm first.
