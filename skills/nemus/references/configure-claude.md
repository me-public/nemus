# Configure Claude

Configure Claude Code integration settings.

## Instructions

```bash
nemus configure-claude
```

Alias:
```bash
w cc
```

## Settings

| Setting | Description | Default |
|---|---|---|
| Auto-launch Claude | Launch Claude Code after workspace creation | `true` |
| Generate context | Create `.claude.md` context file in workspaces | `true` |

## Notes

- This is interactive-only — there are no non-interactive flags.
- The `.claude.md` file provides workspace context to Claude Code sessions.
- Auto-launch requires the Claude Code CLI to be installed.

