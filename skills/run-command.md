---
name: run-command
description: Run a shell command across all repos in a workspace
---

# Run Command

Run a shell command across all repos in a workspace.

## Running

```bash
nemus run <workspace-name> "<command>"
```

Example:
```bash
nemus run my-workspace "git log --oneline -5"
```

## Presenting Results

Report the output from each repo, clearly labeling which output comes from which repo.
