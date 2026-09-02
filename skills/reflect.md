---
name: reflect
description: Retrospective on recent agent sessions — get concrete tips to improve skills, context, and prompts
---

Analyze recent workspaces' agent sessions and get setup improvement tips (read-only; changes no repos):
```bash
nemus reflect                     # most recent workspaces (default 10)
nemus reflect --workspace <name>  # a single workspace
nemus reflect --markdown > reflection.md   # shareable report
```

Review saved reports (saved under `~/.nemus/reflect/` unless `--no-save`):
```bash
nemus reflect history      # list past reports
nemus reflect show [id]    # show one (defaults to latest)
```

- Uses *your own* configured agent (claude/pi/opencode) as the judge — no API key of Nemus's.
- `--json` / `--markdown` for machine or shareable output; `--group-by kind|priority`.
- Safe: it reads transcripts and prints advice, nothing is modified.
