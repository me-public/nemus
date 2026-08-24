# Archive Workspace

Archive a workspace to hide it from default listings. Archived workspaces auto-delete after 30 days.

## Instructions

### Archive
```bash
nemus archive --workspace <name> --yes
```

### Unarchive
```bash
nemus archive --unarchive --workspace <name> --yes
```

To list archived workspaces first:
```bash
nemus list --archived
```

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Workspace name(s), comma-separated for multiple |
| `--yes` | `-y` | Skip confirmation prompt |
| `--unarchive` | | Restore instead of archive |

## When to Suggest

- Suggest archiving instead of deleting when the user may need the workspace later.
- Suggest unarchiving when the user asks about a workspace that was recently archived.

## Success Criteria

- Workspace is hidden from default `nemus list` results.
- User is aware of the 30-day auto-delete policy.
