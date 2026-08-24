# List Workspaces

List all existing workspaces managed by workspace-manager.

## Instructions

1. Run:
   ```bash
   grove list
   ```
   Pass `--archived` only if the user asks to see archived workspaces:
   ```bash
   grove list --archived
   ```

2. Present the results showing:
   - Workspace name
   - Number of repositories
   - Creation date
   - Archived status (if applicable)

3. If no workspaces exist, suggest creating one with `grove create`.

## Success Criteria

- All active workspaces are listed with repo count and creation date.
- Archived workspaces are shown only when explicitly requested.
