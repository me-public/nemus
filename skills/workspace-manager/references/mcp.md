# MCP Server

Manage the MCP (Model Context Protocol) server integration with Claude Code.

## Commands

### Install

Register the workspace-manager MCP server with Claude Code:
```bash
nemus mcp install
```

This also installs shell integration, permission sync hooks, and workspace skills.

### Uninstall

Remove the MCP server registration:
```bash
nemus mcp uninstall
```

### Upgrade

Update hooks and skills without re-registering the MCP server:
```bash
nemus mcp upgrade
```

Use after updating the workspace-manager package.

### Status

Check if the MCP server is registered:
```bash
nemus mcp status
```

## What MCP Provides

When installed, Claude Code gains access to workspace-manager tools:
- `create-workspace`, `list-workspaces`, `workspace-status`, etc.
- Enables natural language workspace management via `nemus -- <prompt>`

## When to Suggest

- After installing or upgrading workspace-manager
- When Claude Code doesn't seem to have workspace tools
- When `nemus -- <prompt>` fails to find MCP tools
