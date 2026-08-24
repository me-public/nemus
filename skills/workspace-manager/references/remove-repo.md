# Remove Repo

Remove a repository instance from a workspace.

## Instructions

1. Warn the user about any uncommitted changes before removing.

2. Run the command:
   ```bash
   grove remove-repo --workspace <name> --repos <dir-name> --yes
   ```

   Note: `--repos` takes the **directory name** inside the workspace (not the GitHub repo name — these differ when using suffixes).

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Target workspace |
| `--repos <dir,...>` | `-r` | Comma-separated directory names to remove |
| `--yes` | `-y` | Skip confirmation prompt |

## Success Criteria

- The specified repo directory is removed from the workspace after user confirmation.
