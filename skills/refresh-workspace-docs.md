---
name: refresh-workspace-docs
description: Refresh the per-repo documentation embedded in a workspace's context file (AGENTS.md / .claude.md). Use when a workspace was created a while ago and its repos have since received updates to their README, AGENTS.md, or CLAUDE.md files, so the embedded copies in the workspace context are stale.
---

```bash
nemus sync <workspace>       # 1. git pull every repo so on-disk docs are current
nemus migrate                # 2. rebuild the Per-Repository Context section from disk
```

- Use `nemus migrate --dry-run` first to preview scope.
- `nemus migrate` runs across **all** workspaces; it's idempotent and only touches the `## Per-Repository Context` section — your `## Notes` and `CONTEXT.md` are preserved.
- Per repo it embeds the first of `AGENTS.md` → `.claude.md` → `CLAUDE.md` found (up to 2 dir levels deep). If none exist, the section is omitted.
