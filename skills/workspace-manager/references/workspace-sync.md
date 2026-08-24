# Workspace Sync

Pull latest changes for all repositories in a workspace. Skips repos with uncommitted changes.

## Instructions

```bash
grove sync <workspace>
```

Or with flag:
```bash
grove sync --workspace <name>
```

Report results per repo:
- Which repos were successfully pulled
- Which repos were skipped (uncommitted changes)
- Any repos that failed

If some repos were skipped, suggest committing or stashing changes first, then re-run `grove sync <name>`.

## Success Criteria

- All clean repos are pulled to latest.
- User is informed of any skipped repos with uncommitted changes.
