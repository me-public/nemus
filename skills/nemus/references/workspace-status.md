# Workspace Status

Show git status (branch, clean/dirty, ahead/behind) for all repositories in a workspace.

## Instructions

```bash
nemus status <workspace>
```

Alias:
```bash
nem st <workspace>
```

Without a workspace name, prompts interactively:
```bash
nemus status
```

## Output

Displays a table per repository showing:
- **Repo name**
- **Branch** (with detached HEAD warning)
- **Status** — clean ✓ or modified/untracked count
- **Ahead/Behind** — commits ahead/behind remote
- **Modified files** count

Plus a summary: clean repos, dirty repos, needs push, needs pull.

