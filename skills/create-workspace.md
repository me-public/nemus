---
name: create-workspace
description: Create a new multi-repo workspace by cloning repositories from the org using `nemus create`. ALWAYS use this skill — never run `git clone` directly — when the user asks to create a workspace, set up a new workspace, or start fresh with a set of repos.
---

# Create Workspace

Create a new workspace by cloning repositories.

## Resolving Repositories

If the user hasn't specified which repos to clone, help them discover:
```bash
nemus cache search <keyword>
```

## Creating the Workspace

Run non-interactively:
```bash
nemus create --workspace <name> --repos <repo1,repo2,...> --yes
```

Or interactively (prompts for workspace name and repos):
```bash
nemus create
```

## Presenting Results

Report:
- Workspace created at path
- Successfully cloned repos
- Any failures with their error reason

## Suggested Follow-ups

- `nemus status <name>` to verify
- `nemus update --workspace <name> --repos <more-repos>` to add more repos later
