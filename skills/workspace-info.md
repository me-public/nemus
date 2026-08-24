---
name: workspace-info
description: Get detailed metadata for a workspace
---

# Workspace Info

Get detailed metadata for a workspace including all repository info, tags, and disk path.

## Resolving the Workspace

If the user hasn't specified a workspace name, list them:
```bash
grove list 2>&1 | cat
```

## Getting Info

Read the workspace metadata file (path is relative to the workspace directory):
```bash
cat <workspace-path>/.workspace-meta.json
```

The workspace path can be found by checking the current directory or using:
```bash
grove status <workspace-name>
```

## Presenting Results

The JSON contains workspace metadata. Present clearly:

- **Name** and **creation date**
- **Disk path** where the workspace lives
- **Repositories** - list each with:
  - Directory name (may differ from repo name if a suffix was used)
  - Clone URL
  - Status (success/failed from creation)
- **Tags** and any custom metadata if present

## Suggested Follow-ups

- `grove status <workspace>` to see current git status of each repo
- `grove update --workspace <name> --repos <repos>` to add more repos
- `grove doctor <workspace>` to check workspace health
