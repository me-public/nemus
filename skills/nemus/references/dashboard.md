# Dashboard

Launch a tmux-based multi-agent management dashboard for monitoring and controlling Claude agents across workspaces.

## Instructions

```bash
nemus dashboard
nemus dash
```

Opens a tmux session with a sidebar showing active agents and their status. Agent panes are on the right.

## Options

| Flag | Description |
|---|---|
| `--install-hooks` | Install Claude status hooks without launching dashboard |
| `--uninstall-hooks` | Remove dashboard hooks from Claude settings |
| `--list` | List running agents as JSON (non-interactive) |
| `--status` | Show agent status summary (non-interactive) |
| `--kill <sessionId>` | Kill agent by session ID (non-interactive) |
| `--launch <workspace>` | Launch agent in workspace (non-interactive) |

## Keyboard Shortcuts (sidebar)

| Key | Action |
|---|---|
| `↑` / `↓` | Select agent |
| `f` / `Enter` | Focus selected agent pane |
| `z` | Toggle zoom on selected agent (hides others) |
| `x` | Kill selected agent |
| `n` | Launch new agent (workspace picker) |
| `s` | Resume a previous Claude session |
| `r` | Reset layout |
| `q` | Detach — agents keep running in background |
| `Q` | Quit all — kills session and all agents |

## From any agent pane

| Key | Action |
|---|---|
| `prefix+M` | Return to sidebar / reset layout |

## Prerequisites

- `tmux` must be installed (`brew install tmux`)
- Claude CLI must be available for agent launching

## Features

- Real-time agent status via Claude Code hooks (idle/working/waiting/stopped)
- Session persistence: `q` detaches, `nemus dash` reconnects
- Zoom mode: selected agent takes full right side, others hidden
- Session resume picker (`s`) with fuzzy search
- Auto-installs Claude hooks on first run

