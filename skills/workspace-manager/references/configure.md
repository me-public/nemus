# Configure

Configure workspace-manager global settings interactively.

## Instructions

```bash
nemus configure
```

Alias:
```bash
w cfg
```

## Settings

| Setting | Description | Default |
|---|---|---|
| Workspaces directory | Where workspaces are stored | `~/workspaces` |
| GitHub organization | Org to fetch repos from | `your-org` |
| Clone protocol | SSH or HTTPS | `ssh` |
| Auto-launch Claude | Launch Claude after workspace creation | `true` |
| Generate .claude.md | Create context file in workspaces | `true` |
| MCP server | Install MCP server for Claude integration | `true` |

## Notes

- Changing the GitHub org clears the repo cache automatically.
- Enabling MCP after disabling it triggers an automatic install.
- This is interactive-only — there are no non-interactive flags.

## Success Criteria

- User's settings are saved to `~/.nemus/config.json`.
