---
name: workspace-status
description: Show git status for all repos in a workspace
---

# Workspace Status

Show git status across all repos in a workspace.

## Running

```bash
grove status <workspace-name>
```

Or for the current workspace:
```bash
grove status
```

## Presenting Results

The command shows per-repo git status (branch, uncommitted changes, ahead/behind). Report:
- Which repos have uncommitted changes
- Which repos are on non-default branches
- Any repos that are ahead/behind remote
