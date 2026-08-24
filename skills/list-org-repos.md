---
name: list-org-repos
description: List all organization repositories from GitHub
---

# List Org Repos

List all repositories in the GitHub organization.

## Running

```bash
nemus cache list
```

If the cache is empty or stale:
```bash
nemus cache refresh
```

## Presenting Results

Show repo names. Can be filtered by searching:
```bash
nemus cache search <keyword>
```
