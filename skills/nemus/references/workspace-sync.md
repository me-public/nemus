# Workspace Sync

Pull latest changes for all repositories in a workspace. Skips repos with uncommitted changes.

## Instructions

```bash
nemus sync <workspace>
```

Or with flag:
```bash
nemus sync --workspace <name>
```

Report results per repo:
- Which repos were successfully pulled
- Which repos were skipped (uncommitted changes)
- Any repos that failed

If some repos were skipped, suggest committing or stashing changes first, then re-run `nemus sync <name>`.

