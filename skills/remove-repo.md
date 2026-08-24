---
name: remove-repo
description: Remove a repository from a workspace
---

# Remove Repo

Remove a repository from a workspace.

## Running

```bash
nemus remove-repo --workspace <name> --repo <repo-name> --yes
```

Or interactively:
```bash
nemus remove-repo
```

## Important Notes

- This removes the repo directory from the workspace
- The repo is not deleted from GitHub, only removed locally
- The workspace metadata is updated to reflect the removal
