---
name: workspace-manager
description: Manage multi-repo development workspaces — create, sync, branch, diff, clone, archive, analyze dependencies, run commands across repos, check status, clean up, delete, list org repos, search repos, list suites, remove repo, cache, suite management, sessions, history, generate docs, configure, MCP server, AI prompt. Use when working with workspaces, repos, branches, git operations across multiple repos, or the `nemus` CLI tool. NEVER use `git clone` directly — always use `nemus update` to add repos and `nemus create` to create workspaces.
bashPattern: "\\bnemus\\s+(create|list|update|delete|sync|status|diff|run|go|doctor|analyze-deps|history|cleanup|remove-repo|archive|sessions|generate-docs|configure|configure-claude|ghq-status|tui|dashboard|dash|branch|suite|cache|mcp|--)\\b"
---

# Workspace Manager

> **CRITICAL — Read before taking any action:**
> - **NEVER** run `git clone` directly to add a repository to a workspace.
> - **NEVER** run `git clone` directly to create a workspace.
> - **NEVER** use `git worktree` to get a second checkout of a tracked repo — worktrees are invisible to `nemus status`/`nemus sync`. Add another instance with `nemus update --repos <repo>:<suffix>` instead.
> - **ONLY read code from repos in the CURRENT workspace.** If you need to read or reference code from a repo that isn't in the current workspace, add it with `nemus update --workspace <current> --repos <repo> --yes` and read it there. **NEVER** read that repo's code from another workspace, a global ghq/clone path, or anywhere outside the current workspace — other workspaces may be on different branches or stale, and reading them silently breaks context isolation.
> - **ALWAYS** use `nemus update --workspace <name> --repos <repo> --yes` to add repos.
> - To add the **same repo more than once** (e.g. a second branch checkout), use `nemus update --workspace <name> --repos <repo>:<suffix> --yes` — it clones into `<repo>-<suffix>` and is tracked independently.
> - **ALWAYS** use `nemus create --workspace <name> --repos <repos> --yes` to create workspaces.
> - Direct git operations bypass workspace metadata, break `nemus status`/`nemus sync`, and leave context files stale.

Manage multi-repo development workspaces using the `nemus` CLI tool (alias: `nem`).

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
nemus create --workspace payments --repos partnerships-api,payments-db --yes

# Partially interactive (prompts for repos)
nemus create --workspace payments

# Fully interactive (prompts for everything)
nemus create
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
| Create a workspace | [create-workspace](references/create-workspace.md) | `nemus create` |
| Add repos to workspace | [update-workspace](references/update-workspace.md) | `nemus update` |
| Check git status | [workspace-status](references/workspace-status.md) | `nemus status <name>` |
| Pull latest changes | [workspace-sync](references/workspace-sync.md) | `nemus sync <name>` |
| List all workspaces | [list-workspaces](references/list-workspaces.md) | `nemus list` |
| Navigate to workspace | [go](references/go.md) | `nemus go <name>` or `nemgo <name>` |
| Search for repos | [search-repos](references/search-repos.md) | `nemus cache search <query>` |
| Resume Claude session | [sessions](references/sessions.md) | `nemus sessions` |

## Command Reference

### Core Workspace Lifecycle

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Create new workspace | [create-workspace](references/create-workspace.md) | `nemus create` | `c` |
| Add repos to workspace | [update-workspace](references/update-workspace.md) | `nemus update` | `u` |
| Delete workspace permanently | [delete-workspace](references/delete-workspace.md) | `nemus delete` | `d` |
| Archive / unarchive workspace | [archive-workspace](references/archive-workspace.md) | `nemus archive` | `a` |
| List all workspaces | [list-workspaces](references/list-workspaces.md) | `nemus list` | `l` |
| Navigate to workspace | [go](references/go.md) | `nemus go [name]` | — |

### Status & Operations

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Git status across repos | [workspace-status](references/workspace-status.md) | `nemus status [name]` | `st` |
| Pull latest (git sync) | [workspace-sync](references/workspace-sync.md) | `nemus sync [name]` | `s` |
| Show diff summary | [workspace-diff](references/workspace-diff.md) | `nemus diff [name]` | `di` |
| Run shell command across repos | [run-command](references/run-command.md) | `nemus run [name] <cmd>` | `r` |
| Health check | [workspace-doctor](references/workspace-doctor.md) | `nemus doctor [name]` | `doc` |
| Clean node_modules / artifacts | [workspace-cleanup](references/workspace-cleanup.md) | `nemus cleanup <name>` | `cl` |
| Remove repo from workspace | [remove-repo](references/remove-repo.md) | `nemus remove-repo` | `rr` |
| Analyze inter-repo deps | [analyze-deps](references/analyze-deps.md) | `nemus analyze-deps [name]` | `ad` |
| Generate docs for workspace | [generate-docs](references/generate-docs.md) | `nemus generate-docs [name]` | `gd` |

### Branch Management

| Intent | Reference | CLI |
|---|---|---|
| Switch branch across repos | [switch-branch](references/switch-branch.md) | `nemus branch switch` |
| Create branch across repos | [branch-create](references/branch-create.md) | `nemus branch create` |
| Merge branches across repos | [branch-merge](references/branch-merge.md) | `nemus branch merge <ws> <src> <tgt>` |
| Rebase branches across repos | [branch-rebase](references/branch-rebase.md) | `nemus branch rebase <ws> <base>` |

### Suites (Reusable Repo Collections)

| Intent | Reference | CLI |
|---|---|---|
| List saved suites | [list-suites](references/list-suites.md) | `nemus suite list` |
| Create a suite | [suite-create](references/suite-create.md) | `nemus suite create` |
| Delete a suite | [suite-delete](references/suite-delete.md) | `nemus suite delete` |
| Export suite(s) to JSON | [suite-export](references/suite-export.md) | `nemus suite export [file]` |
| Import suite(s) from JSON | [suite-import](references/suite-import.md) | `nemus suite import <file>` |
| Create workspace from suite | [suite-use](references/suite-use.md) | `nemus suite use` |

### Cache & Repo Discovery

| Intent | Reference | CLI |
|---|---|---|
| Search org repos | [search-repos](references/search-repos.md) | `nemus cache search <query>` |
| List all org repos | [list-org-repos](references/list-org-repos.md) | `nemus cache list` |
| View cache statistics | [cache-info](references/cache-info.md) | `nemus cache info` |
| Refresh repo cache | [update-cache](references/update-cache.md) | `nemus cache refresh` |
| Clear cache | [cache-clear](references/cache-clear.md) | `nemus cache clear` |

### Sessions & History

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Resume Claude session | [sessions](references/sessions.md) | `nemus sessions` | `ses` |
| Agent management dashboard | [dashboard](references/dashboard.md) | `nemus dashboard` | `dash` |
| View operation history | [history](references/history.md) | `nemus history` | `h` |
| View history statistics | [history](references/history.md) | `nemus history stats` | — |
| Clear history | [history](references/history.md) | `nemus history clear` | — |

### Configuration

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Configure workspace manager | [configure](references/configure.md) | `nemus configure` | `cfg` |
| Configure Claude integration | [configure-claude](references/configure-claude.md) | `nemus configure-claude` | `cc` |
| Check ghq status | [ghq-status](references/ghq-status.md) | `nemus ghq-status` | — |

### MCP Server

| Intent | Reference | CLI |
|---|---|---|
| Install MCP server | [mcp](references/mcp.md) | `nemus mcp install` |
| Uninstall MCP server | [mcp](references/mcp.md) | `nemus mcp uninstall` |
| Upgrade MCP hooks/skills | [mcp](references/mcp.md) | `nemus mcp upgrade` |
| Check MCP status | [mcp](references/mcp.md) | `nemus mcp status` |

### AI Assistant

| Intent | Reference | CLI |
|---|---|---|
| Natural language workspace management | [ai-prompt](references/ai-prompt.md) | `nemus -- <prompt>` |

### Interactive TUI

| Intent | CLI |
|---|---|
| Launch full interactive terminal UI | `nemus tui` |

## Routing

When the user's intent matches a row above, read the corresponding reference file for step-by-step instructions before running any CLI command. If no reference file exists for a command, use `nemus <command> --help` to get usage details.

> **Reminder**: Do not use bare `git clone`, `git pull`, or other git commands to manage workspace repos.
> All repo management **must** go through `nemus` commands so that workspace metadata and context files stay in sync.

## Deprecated Aliases

These still work but print a deprecation warning. Use the modern form instead:

| Old | New |
|-----|-----|
| `nemus sc` | `nemus suite create` |
| `nemus sls` | `nemus suite list` |
| `nemus sd` | `nemus suite delete` |
| `nemus se` | `nemus suite export` |
| `nemus si` | `nemus suite import` |
| `nemus fs` | `nemus suite use` |
| `nemus sb` | `nemus branch switch` |
| `nemus bc` | `nemus branch create` |
| `nemus bm` | `nemus branch merge` |
| `nemus br` | `nemus branch rebase` |
| `nemus uc` | `nemus cache refresh` |
