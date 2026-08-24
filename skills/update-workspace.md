---
name: update-workspace
description: Add one or more repositories to an existing workspace. ALWAYS use this skill — never run `git clone` directly — when the user asks to add, clone, include, or pull a new repo into the current workspace. Triggers on phrases like "add repo X", "include X in this workspace", "I need X here", "clone X into workspace", "add a service".
---

# Update Workspace

> **CRITICAL**: NEVER use `git clone` directly to add repositories to a workspace.
> Always use `grove update` — it registers the repo in workspace metadata, updates
> the context file, and keeps `grove status`/`grove sync` working correctly.

Add more repositories to an existing workspace.

## Resolving the Workspace

If the user hasn't specified a workspace, run:
```bash
grove list 2>&1 | cat
```

Or to see what's in a specific workspace (from inside the workspace directory):
```bash
cat .workspace-meta.json
```

## Resolving Repositories

If the user hasn't specified which repos to add, help them discover:
```bash
grove cache search <keyword>
```

To see what's already in the workspace (avoid adding duplicates):
```bash
cat .workspace-meta.json | jq '.repositories[].name'
```

## Adding Repos

Run the update command non-interactively:
```bash
grove update --workspace <name> --repos <repo1,repo2,...> --yes
```

### Adding the same repo more than once (instances)

Append `:suffix` to a repo name to add it again under a separate folder
(`<repo>-<suffix>`) — e.g. a second checkout for another branch instead of a
`git worktree` (worktrees are invisible to `grove status`/`grove sync`):
```bash
grove update --workspace <name> --repos casper:cas-101 --yes   # -> casper-cas-101
```
Suffix = letters, numbers, hyphens, underscores. Each instance is tracked
independently by `grove status`/`grove sync`.

## Presenting Results

The command output shows which repos were added and which were skipped. Report:
- Successfully added repos
- Skipped repos (already exist in workspace) - this is not an error
- Any failures with their error reason

## Suggested Follow-ups

- `grove status <workspace>` to verify the new repos
- `grove sync <workspace>` to pull latest on all repos
