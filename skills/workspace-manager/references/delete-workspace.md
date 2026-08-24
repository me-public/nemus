# Delete Workspace

Permanently delete one or more workspaces and all their cloned repositories.

## Instructions

1. **Confirm with the user before deleting.** This is a destructive, irreversible operation.

2. Warn the user about any uncommitted changes — run `grove status <name>` to check first.

3. Run the command:
   ```bash
   grove delete --workspace <name> --yes
   ```

   For multiple workspaces (comma-separated):
   ```bash
   grove delete --workspace <name1>,<name2> --yes
   ```

4. Consider suggesting `grove archive --workspace <name> --yes` as an alternative.

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Workspace name(s), comma-separated for multiple |
| `--yes` | `-y` | Skip confirmation prompt |

## Success Criteria

- Workspace directory and all cloned repos are removed from disk.
- User received explicit confirmation before deletion (unless `--yes` was passed).
