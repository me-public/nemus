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

