---
name: search-repos
description: Search org repositories by name or description
---

# Search Repos

Search for repositories in the GitHub organization.

## Searching

```bash
grove cache search <keyword>
```

This searches the cached list of org repos by name. Results show repo name and description.

## If Cache is Empty

```bash
grove cache refresh
```

Then search again.

## Presenting Results

Show matching repos with their names and descriptions. If the user wants to add repos to a workspace, suggest:
```bash
grove update --workspace <name> --repos <repo1,repo2> --yes
```
