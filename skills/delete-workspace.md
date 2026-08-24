---
name: delete-workspace
description: Delete one or more workspaces and all their contents permanently
---

# Delete Workspace

Delete one or more workspaces permanently.

## Resolving the Workspace

If the user hasn't specified which workspace to delete:
```bash
grove list 2>&1 | cat
```

## Deleting

Run non-interactively:
```bash
grove delete --workspace <name> --yes
```

Or interactively (prompts for confirmation):
```bash
grove delete
```

## Important Notes

- This permanently removes the workspace directory and all its contents
- There is no undo — repos will need to be re-cloned
- Always confirm with the user before deleting

## Suggested Follow-ups

- `grove list` to verify the workspace is gone
