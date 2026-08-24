---
name: refresh-workspace-docs
description: Refresh the per-repo documentation embedded in a workspace's context file (AGENTS.md / .claude.md). Use when a workspace was created a while ago and its repos have since received updates to their README, AGENTS.md, or CLAUDE.md files, so the embedded copies in the workspace context are stale.
---

# Refresh Workspace Docs

When a workspace is created, each repo's own `AGENTS.md` / `CLAUDE.md` is
embedded into the workspace-level context file (`AGENTS.md` / `.claude.md`)
under the **Per-Repository Context** section. Those embedded copies are a
snapshot taken at creation time — they do **not** auto-update when the repo
later receives new commits that change its README or agent docs.

This skill refreshes that embedded content so the agent works from the
latest per-repo guidance.

## When to Use

- A workspace was created days/weeks ago and the repos have since changed.
- A repo's `AGENTS.md` / `CLAUDE.md` / `README.md` was updated upstream and
  you want the workspace context to reflect it.
- The agent seems to be following outdated repo-specific instructions.
- After a teammate merges changes to a repo's documentation.

## Workflow

Two steps: **sync the repos to latest**, then **regenerate the context**.

### 1. Pull the latest for every repo in the workspace

```bash
nemus sync <workspace-name>
```

This `git pull`s every repo so their on-disk `README.md`, `AGENTS.md`, and
`CLAUDE.md` reflect the latest upstream content. (Omit the name to sync the
current workspace.)

### 2. Regenerate the workspace context

```bash
w migrate
```

`nemus migrate` re-reads each repo's context files from disk and **surgically
updates only the `## Per-Repository Context` section** of the workspace
`AGENTS.md` / `.claude.md`. Your own notes (the `## Notes` section, saved
`CONTEXT.md`, etc.) are preserved untouched.

Preview what would change first with:

```bash
w migrate --dry-run
```

## What Gets Refreshed

The `## Per-Repository Context` section is rebuilt from each repo's context
file, discovered in this priority order (per repo, up to 2 directory levels
deep for monorepo packages):

1. `AGENTS.md`
2. `.claude.md`
3. `CLAUDE.md`

Each repo's content is embedded with imperative scoping ("You MUST follow
these rules whenever you work with files inside `<repo>/`") and placed near
the top of the workspace context file so the agent weights it heavily.

## Notes

- This only refreshes **embedded** per-repo docs in the workspace context
  file. The repos themselves are updated by `nemus sync` in step 1.
- `nemus migrate` runs across **all** workspaces. That's safe and idempotent —
  every workspace gets its per-repo section refreshed from current on-disk
  content. Use `--dry-run` first if you want to see scope.
- If a workspace has no repo-level context files, the section is omitted
  (or removed if it previously existed).

## Example

```bash
# Workspace 'payments' was created 3 weeks ago; partnerships-api has since
# rewritten its AGENTS.md with new Jira board instructions.

nemus sync payments        # pull latest — partnerships-api/AGENTS.md now current
w migrate --dry-run    # preview: "payments: would embed per-repo context from 4 location(s)"
w migrate              # apply — workspace AGENTS.md now has the new instructions
```
