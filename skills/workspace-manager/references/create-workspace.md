# Create Workspace

Create a new workspace with specified repositories.

## Instructions

1. If the user hasn't specified which repos they want, help them discover repos:
   - Run `nemus cache search <query>` to search by name or description.
   - Run `nemus cache list` to browse all available repos.
   - Run `nemus suite list` to see pre-defined repo collections.

2. Run the command with flags (non-interactive):
   ```bash
   nemus create --workspace <name> --repos <r1,r2,...> --yes
   ```

   Or interactively (no flags needed — CLI will prompt):
   ```bash
   nemus create
   ```

3. After creation, suggest next steps:
   - `nemgo <name>` to navigate to the workspace (requires shell integration)
   - Run `nemus status <name>` to check the initial state
   - Run `nemus sync <name>` to pull latest changes

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Workspace name |
| `--repos <r1,r2,...>` | `-r` | Comma-separated repo names |
| `--yes` | `-y` | Skip confirmation prompt; also skips auto-launching the AI agent afterward, so the command is safe to run as a one-shot/non-interactive call |

## Examples

```bash
nemus create --workspace payments --repos partnerships-api,payments-db --yes
nemus suite use --suite platform --workspace platform-ws --yes
```

## Success Criteria

- Workspace directory exists with all requested repos cloned.
- User is informed of the workspace path and suggested next steps.
