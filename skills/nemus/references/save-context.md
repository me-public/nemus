# Save Context

`nemus save-context` (alias `ctx`) writes a progress summary to the workspace's
`CONTEXT.md`, so work survives `/clear` or a new session. Read `CONTEXT.md` back
at the start of a session to resume. The workspace defaults to the current
directory; pass `-w` to target another.

```bash
nemus save-context -m "…"                 # save to the current workspace
nemus save-context -w <name> -m "…"       # target a specific workspace
nemus save-context                        # interactive: prompts for the summary
nemus save-context -f notes.md --append   # read from a file, append (don't replace)
```

Use it to capture: what was done, what's in progress, key decisions, and the
next steps — before a context reset or when handing off.

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Workspace name (default: current directory) |
| `--message <text>` | `-m` | Summary text to save (skips the prompt) |
| `--file <path>` | `-f` | Read the summary from a file |
| `--append` | | Append to existing context instead of replacing |
