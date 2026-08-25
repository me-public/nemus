# Archive Workspace

```bash
nemus archive --workspace <name> --yes
```

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
