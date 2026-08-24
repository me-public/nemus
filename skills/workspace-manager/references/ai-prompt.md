# AI Prompt

Use natural language to manage workspaces via Claude Code with MCP tools.

## Instructions

```bash
grove -- <prompt>
```

The `--` separates the workspace command from the natural language prompt.

## Examples

```bash
grove -- "Create a workspace with all payments repos"
grove -- "What workspaces do I have?"
grove -- "Add payments-db to my payments workspace"
grove -- "Show me the status of my platform workspace"
grove -- "Set up a workspace for the billing migration"
```

## How It Works

1. Launches Claude Code CLI with a system prompt describing all available MCP tools
2. Claude interprets the natural language request
3. Claude uses MCP tools (create-workspace, search-repos, etc.) to fulfill the request
4. Results are presented conversationally

## Prerequisites

- Claude Code CLI must be installed (`claude` command available)
- MCP server should be installed (`grove mcp install`)

## When to Suggest

- User wants to manage workspaces conversationally
- User describes a complex workspace setup in natural language
- User is new to the CLI and prefers natural language

## Notes

- The shell integration treats `grove --` as a create-like command — if a workspace is created, it auto-CDs into it.
- This is interactive-only and requires a TTY.
