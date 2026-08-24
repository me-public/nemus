# Workspace Status

Show git status (branch, clean/dirty, ahead/behind) for all repositories in a workspace.

## Instructions

```bash
grove status <workspace>
```

Alias:
```bash
w st <workspace>
```

Without a workspace name, prompts interactively:
```bash
grove status
```

## Output

Displays a table per repository showing:
- **Repo name**
- **Branch** (with detached HEAD warning)
- **Status** — clean ✓ or modified/untracked count
- **Ahead/Behind** — commits ahead/behind remote
- **Modified files** count

Plus a summary: clean repos, dirty repos, needs push, needs pull.

## Suggested Follow-ups

Based on the results:
- Uncommitted changes → suggest `grove diff <name>` to see details
- Behind remote → suggest `grove sync <name>` to pull latest
- Mixed branches → suggest `grove branch switch` to align
- Repos ahead of remote → suggest pushing changes

## Success Criteria

- Per-repo status is displayed in a clear table.
- Summary highlights any repos needing attention.
