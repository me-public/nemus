# MCP Server

Register the Nemus MCP server with Claude Code:
```bash
nemus mcp install
```

This also installs shell integration, permission sync hooks, and workspace skills.

Remove the MCP server registration:
```bash
nemus mcp uninstall
```

Update hooks and skills without re-registering the MCP server:
```bash
nemus mcp upgrade
```

Use after updating the Nemus package.

Check if the MCP server is registered:
```bash
nemus mcp status
```

## What MCP Provides

When installed, Claude Code gains access to Nemus tools:
- `create-workspace`, `list-workspaces`, `workspace-status`, etc.
- Enables natural language workspace management via `nemus -- <prompt>`
