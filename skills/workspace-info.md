---
name: workspace-info
description: Get detailed metadata for a workspace
---

# Workspace Info

Get detailed metadata for a workspace including all repository info, tags, and disk path.

## Resolving the Workspace

If the user hasn't specified a workspace name, list them:
```bash
nemus list 2>&1 | cat
```

## Getting Info

Read the workspace metadata file (path is relative to the workspace directory):
```bash
cat <workspace-path>/.workspace-meta.json
```

The workspace path can be found by checking the current directory or using:
```bash
nemus status <workspace-name>
```

