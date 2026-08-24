# Sessions

Pick a workspace with an active Claude Code session and resume it.

## Instructions

Interactive only — displays a fuzzy-searchable list of workspaces with sessions:
```bash
grove sessions
```

Alias:
```bash
w ses
```

## How It Works

1. Scans for Claude Code sessions across all workspaces
2. Shows them sorted by last active time
3. User picks one → terminal CDs to that workspace and resumes the Claude session

## When to Suggest

- User asks to "continue where I left off"
- User wants to resume work on a previous workspace
- User asks about their recent Claude sessions
