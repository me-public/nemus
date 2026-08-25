# List Workspaces

1. Run:
   ```bash
   nemus list
   ```
   Pass `--archived` only if the user asks to see archived workspaces:
   ```bash
   nemus list --archived
   ```

2. Present the results showing:
   - Workspace name
   - Number of repositories
   - Creation date
   - Archived status (if applicable)

3. If no workspaces exist, suggest creating one with `nemus create`.
