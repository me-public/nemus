---
name: archive-workspace
description: Archive or unarchive a workspace
---

# Archive Workspace

Archive or unarchive a workspace.

## Archiving

```bash
grove archive <workspace-name>
```

## Unarchiving

```bash
grove archive --unarchive <workspace-name>
```

## Notes

- Archived workspaces are hidden from the default `grove list` view
- Use `grove list --archived` to see archived workspaces
- Archived workspaces are auto-deleted after 30 days
