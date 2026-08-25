---
name: update-workspace
description: Add one or more repositories to an existing workspace. ALWAYS use this skill — never run `git clone` directly — when the user asks to add, clone, include, or pull a new repo into the current workspace. Triggers on phrases like "add repo X", "include X in this workspace", "I need X here", "clone X into workspace", "add a service".
---

> **CRITICAL**: NEVER use `git clone` directly to add repositories to a workspace.
> Always use `nemus update` — it registers the repo in workspace metadata, updates
> the context file, and keeps `nemus status`/`nemus sync` working correctly.

If the user hasn't specified a workspace, run:
```bash
nemus list 2>&1 | cat
```

Or to see what's in a specific workspace (from inside the workspace directory):
```bash
cat .workspace-meta.json
```

If the user hasn't specified which repos to add, help them discover:
```bash
nemus cache search <keyword>
```

To see what's already in the workspace (avoid adding duplicates):
```bash
cat .workspace-meta.json | jq '.repositories[].name'
```

Run the update command non-interactively:
```bash
nemus update --workspace <name> --repos <repo1,repo2,...> --yes
```

Append `:suffix` to a repo name to add it again under a separate folder
(`<repo>-<suffix>`) — e.g. a second checkout for another branch instead of a
`git worktree` (worktrees are invisible to `nemus status`/`nemus sync`):
```bash
nemus update --workspace <name> --repos casper:cas-101 --yes   # -> casper-cas-101
```
Suffix = letters, numbers, hyphens, underscores. Each instance is tracked
independently by `nemus status`/`nemus sync`.
