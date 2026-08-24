---
name: workspace-manager
description: Manage multi-repo development workspaces — create, sync, branch, diff, clone, archive, analyze dependencies, run commands across repos, check status, clean up, delete, list org repos, search repos, list suites, remove repo, cache, suite management, sessions, history, generate docs, configure, MCP server, AI prompt. Use when working with workspaces, repos, branches, git operations across multiple repos, or the `grove` CLI tool. NEVER use `git clone` directly — always use `grove update` to add repos and `grove create` to create workspaces.
bashPattern: "\\bgrove\\s+(create|list|update|delete|sync|status|diff|run|go|doctor|analyze-deps|history|cleanup|remove-repo|archive|sessions|generate-docs|configure|configure-claude|ghq-status|tui|dashboard|dash|branch|suite|cache|mcp|--)\\b"
---

# Workspace Manager

> **CRITICAL — Read before taking any action:**
> - **NEVER** run `git clone` directly to add a repository to a workspace.
> - **NEVER** run `git clone` directly to create a workspace.
> - **NEVER** use `git worktree` to get a second checkout of a tracked repo — worktrees are invisible to `grove status`/`grove sync`. Add another instance with `grove update --repos <repo>:<suffix>` instead.
> - **ONLY read code from repos in the CURRENT workspace.** If you need to read or reference code from a repo that isn't in the current workspace, add it with `grove update --workspace <current> --repos <repo> --yes` and read it there. **NEVER** read that repo's code from another workspace, a global ghq/clone path, or anywhere outside the current workspace — other workspaces may be on different branches or stale, and reading them silently breaks context isolation.
> - **ALWAYS** use `grove update --workspace <name> --repos <repo> --yes` to add repos.
> - To add the **same repo more than once** (e.g. a second branch checkout), use `grove update --workspace <name> --repos <repo>:<suffix> --yes` — it clones into `<repo>-<suffix>` and is tracked independently.
> - **ALWAYS** use `grove create --workspace <name> --repos <repos> --yes` to create workspaces.
> - Direct git operations bypass workspace metadata, break `grove status`/`grove sync`, and leave context files stale.

Manage multi-repo development workspaces using the `grove` CLI tool (alias: `gv`).

All commands support `--help` for detailed usage. The CLI uses Commander.js — every command has auto-generated help at root, command, and subcommand levels.

## Global Flags

These flags work on any command:

| Flag | Short | Description |
|---|---|---|
| `--force-refresh` | `-f` | Force refresh GitHub repos (skip cache) |
| `--yes` | `-y` | Skip all confirmation prompts |
| `--version` | `-V` | Print version number |
| `--help` | `-h` | Show help for any command |

## Non-Interactive Usage (for agents/scripts)

Every command can be run fully non-interactively by providing all required options as flags. When a required value (like workspace name) is missing and there's no TTY, the command will error with a usage hint.

Pattern: **options-first with interactive fallback**.
- If a flag is provided, it's used directly.
- If a flag is omitted and a TTY is available, Inquirer prompts the user.
- `--yes` / `-y` skips all confirmation prompts, and — for commands that create a workspace (`create`, `suite use`) — also skips auto-launching the AI agent afterward in the shell integration, so the command returns immediately instead of dropping into an interactive `claude`/`pi`/`opencode` session.

```bash
# Fully non-interactive
grove create --workspace payments --repos partnerships-api,payments-db --yes

# Partially interactive (prompts for repos)
grove create --workspace payments

# Fully interactive (prompts for everything)
grove create
```

## Command Aliases

| Command | Alias(es) | Command | Alias(es) |
|---------|-----------|---------|-----------|
| `create` | `c` | `diff` | `di` |
| `list` | `l` | `run` | `r` |
| `update` | `u` | `archive` | `a` |
| `delete` | `d`, `del` | `sessions` | `ses` |
| `sync` | `s` | `cleanup` | `cl` |
| `status` | `st` | `remove-repo` | `rr` |
| `doctor` | `doc` | `generate-docs` | `gd` |
| `analyze-deps` | `ad` | `configure` | `cfg` |
| `history` | `h` | `configure-claude` | `cc` |
| `dashboard` | `dash` | | |

## Quick Start

| What you want to do | Reference | CLI Command |
|---|---|---|
| Create a workspace | [create-workspace](references/create-workspace.md) | `grove create` |
| Add repos to workspace | [update-workspace](references/update-workspace.md) | `grove update` |
| Check git status | [workspace-status](references/workspace-status.md) | `grove status <name>` |
| Pull latest changes | [workspace-sync](references/workspace-sync.md) | `grove sync <name>` |
| List all workspaces | [list-workspaces](references/list-workspaces.md) | `grove list` |
| Navigate to workspace | [go](references/go.md) | `grove go <name>` or `gvgo <name>` |
| Search for repos | [search-repos](references/search-repos.md) | `grove cache search <query>` |
| Resume Claude session | [sessions](references/sessions.md) | `grove sessions` |

## Command Reference

### Core Workspace Lifecycle

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Create new workspace | [create-workspace](references/create-workspace.md) | `grove create` | `c` |
| Add repos to workspace | [update-workspace](references/update-workspace.md) | `grove update` | `u` |
| Delete workspace permanently | [delete-workspace](references/delete-workspace.md) | `grove delete` | `d` |
| Archive / unarchive workspace | [archive-workspace](references/archive-workspace.md) | `grove archive` | `a` |
| List all workspaces | [list-workspaces](references/list-workspaces.md) | `grove list` | `l` |
| Navigate to workspace | [go](references/go.md) | `grove go [name]` | — |

### Status & Operations

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Git status across repos | [workspace-status](references/workspace-status.md) | `grove status [name]` | `st` |
| Pull latest (git sync) | [workspace-sync](references/workspace-sync.md) | `grove sync [name]` | `s` |
| Show diff summary | [workspace-diff](references/workspace-diff.md) | `grove diff [name]` | `di` |
| Run shell command across repos | [run-command](references/run-command.md) | `grove run [name] <cmd>` | `r` |
| Health check | [workspace-doctor](references/workspace-doctor.md) | `grove doctor [name]` | `doc` |
| Clean node_modules / artifacts | [workspace-cleanup](references/workspace-cleanup.md) | `grove cleanup <name>` | `cl` |
| Remove repo from workspace | [remove-repo](references/remove-repo.md) | `grove remove-repo` | `rr` |
| Analyze inter-repo deps | [analyze-deps](references/analyze-deps.md) | `grove analyze-deps [name]` | `ad` |
| Generate docs for workspace | [generate-docs](references/generate-docs.md) | `grove generate-docs [name]` | `gd` |

### Branch Management

| Intent | Reference | CLI |
|---|---|---|
| Switch branch across repos | [switch-branch](references/switch-branch.md) | `grove branch switch` |
| Create branch across repos | [branch-create](references/branch-create.md) | `grove branch create` |
| Merge branches across repos | [branch-merge](references/branch-merge.md) | `grove branch merge <ws> <src> <tgt>` |
| Rebase branches across repos | [branch-rebase](references/branch-rebase.md) | `grove branch rebase <ws> <base>` |

### Suites (Reusable Repo Collections)

| Intent | Reference | CLI |
|---|---|---|
| List saved suites | [list-suites](references/list-suites.md) | `grove suite list` |
| Create a suite | [suite-create](references/suite-create.md) | `grove suite create` |
| Delete a suite | [suite-delete](references/suite-delete.md) | `grove suite delete` |
| Export suite(s) to JSON | [suite-export](references/suite-export.md) | `grove suite export [file]` |
| Import suite(s) from JSON | [suite-import](references/suite-import.md) | `grove suite import <file>` |
| Create workspace from suite | [suite-use](references/suite-use.md) | `grove suite use` |

### Cache & Repo Discovery

| Intent | Reference | CLI |
|---|---|---|
| Search org repos | [search-repos](references/search-repos.md) | `grove cache search <query>` |
| List all org repos | [list-org-repos](references/list-org-repos.md) | `grove cache list` |
| View cache statistics | [cache-info](references/cache-info.md) | `grove cache info` |
| Refresh repo cache | [update-cache](references/update-cache.md) | `grove cache refresh` |
| Clear cache | [cache-clear](references/cache-clear.md) | `grove cache clear` |

### Sessions & History

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Resume Claude session | [sessions](references/sessions.md) | `grove sessions` | `ses` |
| Agent management dashboard | [dashboard](references/dashboard.md) | `grove dashboard` | `dash` |
| View operation history | [history](references/history.md) | `grove history` | `h` |
| View history statistics | [history](references/history.md) | `grove history stats` | — |
| Clear history | [history](references/history.md) | `grove history clear` | — |

### Configuration

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Configure workspace manager | [configure](references/configure.md) | `grove configure` | `cfg` |
| Configure Claude integration | [configure-claude](references/configure-claude.md) | `grove configure-claude` | `cc` |
| Check ghq status | [ghq-status](references/ghq-status.md) | `grove ghq-status` | — |

### MCP Server

| Intent | Reference | CLI |
|---|---|---|
| Install MCP server | [mcp](references/mcp.md) | `grove mcp install` |
| Uninstall MCP server | [mcp](references/mcp.md) | `grove mcp uninstall` |
| Upgrade MCP hooks/skills | [mcp](references/mcp.md) | `grove mcp upgrade` |
| Check MCP status | [mcp](references/mcp.md) | `grove mcp status` |

### AI Assistant

| Intent | Reference | CLI |
|---|---|---|
| Natural language workspace management | [ai-prompt](references/ai-prompt.md) | `grove -- <prompt>` |

### Interactive TUI

| Intent | CLI |
|---|---|
| Launch full interactive terminal UI | `grove tui` |

## Routing

When the user's intent matches a row above, read the corresponding reference file for step-by-step instructions before running any CLI command. If no reference file exists for a command, use `grove <command> --help` to get usage details.

> **Reminder**: Do not use bare `git clone`, `git pull`, or other git commands to manage workspace repos.
> All repo management **must** go through `grove` commands so that workspace metadata and context files stay in sync.

## Deprecated Aliases

These still work but print a deprecation warning. Use the modern form instead:

| Old | New |
|-----|-----|
| `grove sc` | `grove suite create` |
| `grove sls` | `grove suite list` |
| `grove sd` | `grove suite delete` |
| `grove se` | `grove suite export` |
| `grove si` | `grove suite import` |
| `grove fs` | `grove suite use` |
| `grove sb` | `grove branch switch` |
| `grove bc` | `grove branch create` |
| `grove bm` | `grove branch merge` |
| `grove br` | `grove branch rebase` |
| `grove uc` | `grove cache refresh` |
