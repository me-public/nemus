# Delete Workspace

1. **Confirm with the user before deleting.** This is a destructive, irreversible operation.

2. Warn the user about any uncommitted changes — run `nemus status <name>` to check first.

3. Run the command:
   ```bash
   nemus delete --workspace <name> --yes
   ```

   For multiple workspaces (comma-separated):
   ```bash
   nemus delete --workspace <name1>,<name2> --yes
   ```

4. Consider suggesting `nemus archive --workspace <name> --yes` as an alternative.

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Workspace name(s), comma-separated for multiple |
| `--yes` | `-y` | Skip confirmation prompt |
