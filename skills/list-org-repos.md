---
name: list-org-repos
description: List all organization repositories from GitHub
---

# List Org Repos

List all repositories in the GitHub organization.

## Running

```bash
grove cache list
```

If the cache is empty or stale:
```bash
grove cache refresh
```

## Presenting Results

Show repo names. Can be filtered by searching:
```bash
grove cache search <keyword>
```
