# Workspace Info

There is no dedicated `nemus info` CLI command. To get workspace information, combine:

1. **List workspaces** to see all available:
   ```bash
   nemus list
   ```

2. **Check status** for repo-level detail:
   ```bash
   nemus status <name>
   ```

3. **Run doctor** for health assessment:
   ```bash
   nemus doctor <name>
   ```

4. **Generate docs** for a comprehensive workspace overview:
   ```bash
   nemus generate-docs <name>
   ```

The MCP tool `workspace-info` provides detailed metadata programmatically.
