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

Call `mcp__nemus__save-context` with:
- `workspace` (string): the workspace name
- `content` (string): markdown content to save
- `append` (boolean, optional): true to append, false to replace (default: false)

## Using the CLI (any agent)

```bash
# Replace existing context
nemus save-context -m "Completed auth refactor. Next: update payment service endpoints."

# Append to existing context
nemus save-context --append -m "Fixed CI failures. All tests passing."

# From a file
nemus save-context -f progress-notes.md

# Pipe content
echo "summary here" | nemus save-context
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
## Current State

All services passing CI. Auth migration is complete for internal services.
External API consumers still use legacy tokens (tracked in JIRA PAY-123).

