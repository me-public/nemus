---
name: list-workspaces
description: List all workspaces with their repo counts and creation dates
---

# List Workspaces

List all workspaces with their status.

## Listing

```bash
grove list
```

Note: This command opens an interactive picker. To just see the output without selecting, pipe it:
```bash
grove list 2>&1 | cat
```

## Presenting Results

Show each workspace with:
- Name
- Number of repositories
- Creation date
- Last active session (if any)
