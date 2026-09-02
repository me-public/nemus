---
name: nemus
description: Manage multi-repo development workspaces — create, sync, branch, diff, clone, archive, analyze dependencies, run commands across repos, check status, clean up, delete, list org repos, search repos, list suites, remove repo, cache, suite management, sessions, history, generate docs, configure, MCP server, AI prompt. Use when working with workspaces, repos, branches, git operations across multiple repos, or the `nemus` CLI tool. NEVER use `git clone` directly — always use `nemus update` to add repos and `nemus create` to create workspaces.
bashPattern: "\\bnemus\\s+(create|list|update|delete|prune|sync|status|diff|run|go|doctor|analyze-deps|reflect|retro|history|cleanup|remove-repo|archive|sessions|save-context|ctx|generate-docs|configure|config|configure-claude|ghq-status|completion|tui|dashboard|dash|branch|suite|cache|mcp|--)\\b"
---

# Nemus

Manage multi-repo workspaces with the `nemus` CLI (alias `nem`). Every command has `--help`.

> **Rules — do not break these:**
> - **Never** `git clone` to add a repo or create a workspace — use `nemus create` / `nemus update`. Direct git bypasses workspace metadata and breaks `nemus status`/`sync`.
> - **Never** `git worktree` for a second checkout — worktrees are invisible to `nemus`. Add another instance with `nemus update --repos <repo>:<suffix>` (clones into `<repo>-<suffix>`, tracked independently).
> - **Only read code from repos in the CURRENT workspace.** Need another repo? Add it with `nemus update --repos <repo>` and read it here — never read from another workspace or a global clone path (they may be stale/on other branches).

## Usage

Commands are options-first with an interactive fallback: pass flags to run non-interactively; omit them (with a TTY) to be prompted. `--yes`/`-y` skips confirmations and the post-create agent launch.

```bash
nemus create --workspace payments --repos partnerships-api,payments-db --yes   # non-interactive
nemus create                                                                    # fully interactive
```

Global flags: `-f/--force-refresh` (skip repo cache), `-y/--yes` (skip prompts), `-V/--version`, `-h/--help`.

## Command Reference

### Core Workspace Lifecycle

| Intent | Reference | CLI | Alias |
|---|---|---|---|
| Create new workspace | [create-workspace](references/create-workspace.md) | `nemus create` | `c` |
| Add repos to workspace | [update-workspace](references/update-workspace.md) | `nemus update` | `u` |
| Delete workspace permanently | [delete-workspace](references/delete-workspace.md) | `nemus delete` | `d` |
| Prune inactive workspaces (safe) | [prune](references/prune.md) | `nemus prune` | — |
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
| Save progress/context to a workspace | [save-context](references/save-context.md) | `nemus save-context` | `ctx` |
| Retrospective on recent sessions | [reflect](references/reflect.md) | `nemus reflect` | `retro` |

### Configuration & MCP

| Intent | Reference | CLI |
|---|---|---|
| Configure Nemus (interactive wizard) | [configure](references/configure.md) | `nemus configure` |
| Get/set config non-interactively | [config](references/config.md) | `nemus config get\|set\|list\|edit` |
| Configure Claude integration | [configure-claude](references/configure-claude.md) | `nemus configure-claude` |
| Check ghq status | [ghq-status](references/ghq-status.md) | `nemus ghq-status` |
| Shell completions (bash/zsh/fish) | [completion](references/completion.md) | `nemus completion <shell>` |
| Install / manage MCP server | [mcp](references/mcp.md) | `nemus mcp install\|status\|upgrade\|uninstall` |

### AI Assistant & TUI

| Intent | Reference | CLI |
|---|---|---|
| Natural-language workspace management | [ai-prompt](references/ai-prompt.md) | `nemus -- <prompt>` |
| Full interactive terminal UI | — | `nemus tui` |

## Routing

Match the user's intent to a row above and read that reference before running commands. If no reference exists, use `nemus <command> --help`. All repo management must go through `nemus` so metadata and context files stay in sync.
