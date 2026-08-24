# Workspace Info

Get detailed metadata for a workspace including all repository info and status.

## Instructions

There is no dedicated `grove info` CLI command. To get workspace information, combine:

1. **List workspaces** to see all available:
   ```bash
   grove list
   ```

2. **Check status** for repo-level detail:
   ```bash
   grove status <name>
   ```

3. **Run doctor** for health assessment:
   ```bash
   grove doctor <name>
   ```

4. **Generate docs** for a comprehensive workspace overview:
   ```bash
   grove generate-docs <name>
   ```

The MCP tool `workspace-info` provides detailed metadata programmatically.

## Success Criteria

- User gets the workspace information they need through the appropriate command.
