---
name: save-context
description: Save progress summary to workspace (persists across /clear and session restarts). Use when you want to preserve important context, findings, or progress before clearing conversation history.
---

# Save Context

Save a progress summary or important context to the workspace. This persists in `CONTEXT.md` and survives `/clear`, session restarts, and agent switches.

## When to Use

- Before `/clear` to preserve progress
- After completing a significant milestone
- To leave notes for the next session
- When switching between tasks in the same workspace

## Using the MCP Tool (Claude Code)

Call `mcp__workspace-manager__save-context` with:
- `workspace` (string): the workspace name
- `content` (string): markdown content to save
- `append` (boolean, optional): true to append, false to replace (default: false)

## Using the CLI (any agent)

```bash
# Replace existing context
grove save-context -m "Completed auth refactor. Next: update payment service endpoints."

# Append to existing context
grove save-context --append -m "Fixed CI failures. All tests passing."

# From a file
grove save-context -f progress-notes.md

# Pipe content
echo "summary here" | grove save-context
```

## What to Save

Good context summaries include:
- **What was done** — completed tasks, merged PRs
- **Current state** — what's working, what's broken
- **Next steps** — what to do next
- **Key decisions** — architectural choices made and why
- **Blockers** — what's blocking progress

## Example

```markdown
## Progress

- Refactored auth service to use JWT tokens (PR #42 merged)
- Updated partnerships-api to call new auth endpoints
- Fixed rate limiting bug in payment-gateway

## Current State

All services passing CI. Auth migration is complete for internal services.
External API consumers still use legacy tokens (tracked in JIRA PAY-123).

## Next Steps

1. Migrate external consumers to JWT (need coordination with partners team)
2. Add monitoring dashboard for token refresh failures
3. Remove legacy token support after 30-day deprecation window
```
