# Reflect — retrospective on recent sessions

`nemus reflect` (alias `retro`) reads your recent workspaces' agent session
transcripts and asks *your own* configured agent (claude/pi/opencode — no API key
of Nemus's) to recommend concrete setup improvements: skills to add, missing
`AGENTS.md`/context rules, missing connectivity/smoke tests, and prompt/workflow
habits — each with a priority and an example.

```bash
nemus reflect                     # analyze the most recent workspaces (default 10)
nemus reflect --limit 20          # widen the window
nemus reflect --workspace <name>  # analyze a single workspace
```

Output / sharing:
```bash
nemus reflect --json              # structured report ({ ok:false, error } on failure)
nemus reflect --markdown > reflection.md   # paste into an issue/PR
nemus reflect --group-by kind     # group recommendations by kind (default: priority)
```

Review saved reports (each run is saved under `~/.nemus/reflect/` unless
`--no-save`):
```bash
nemus reflect history             # list saved reports
nemus reflect show [id]           # show one (id or id-prefix; defaults to latest)
```

## Flags

| Flag | Description |
|---|---|
| `--limit <n>` / `-n` | How many recent workspaces to analyze (default 10) |
| `--workspace <name>` / `-w` | Analyze a single workspace (ignores `--limit`) |
| `--json` | Structured JSON report to stdout |
| `--markdown` | Markdown report to stdout |
| `--group-by <how>` | `priority` (default) or `kind` |
| `--no-save` | Don't save the report to `~/.nemus/reflect/` |
| `--model` / `--thinking` | Judge model / pi thinking-level overrides |
| `--dry-run` | Print the assembled corpus + judge prompt without calling the agent |

Read-only and safe — it analyzes transcripts and prints advice; it changes no
repos. Use it to coach setup, not to modify anything.
