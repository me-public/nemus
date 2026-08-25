# AI Prompt

```bash
nemus -- <prompt>
```

The `--` separates the workspace command from the natural language prompt.

## Examples

```bash
nemus -- "Create a workspace with all payments repos"
nemus -- "What workspaces do I have?"
nemus -- "Add payments-db to my payments workspace"
nemus -- "Show me the status of my platform workspace"
nemus -- "Set up a workspace for the billing migration"
```

1. Launches Claude Code CLI with a system prompt describing all available MCP tools
2. Claude interprets the natural language request
3. Claude uses MCP tools (create-workspace, search-repos, etc.) to fulfill the request
4. Results are presented conversationally

- Claude Code CLI must be installed (`claude` command available)
- MCP server should be installed (`nemus mcp install`)

## Notes

- The shell integration treats `nemus --` as a create-like command — if a workspace is created, it auto-CDs into it.
- This is interactive-only and requires a TTY.
