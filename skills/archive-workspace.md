---
name: archive-workspace
description: Archive or unarchive a workspace
---

```bash
nemus archive <workspace-name>
```

```bash
nemus archive --unarchive <workspace-name>
```

## Notes

- Archived workspaces are hidden from the default `nemus list` view
- Use `nemus list --archived` to see archived workspaces
- Archived workspaces are auto-deleted after 30 days
