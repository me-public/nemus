# dev

Start every repo's dev server in a workspace at once, streaming their output into
one terminal with a color-coded, aligned per-repo prefix. A single Ctrl-C stops
them all cleanly (process-group kill, so child trees die too).

## CLI

```bash
nemus dev [workspace] [options]
```

- `[workspace]` — workspace name; omitted, resolves the current/default one.
- `--only <repos>` — comma-separated subset of repos to start.
- `--script <name>` — npm script to prefer (default: `dev` → `develop` → `start` → `serve`).
- `--command "<cmd>"` — run this exact command in every selected repo instead of a script.
- `--exit-on-failure` — tear everything down if any service exits non-zero.
- `--kill-timeout <seconds>` — grace period before SIGKILL on shutdown (default 5).

## Command selection (per repo)

1. `--command` if given.
2. Else the first `package.json` script that exists (`--script` → `dev` →
   `develop` → `start` → `serve`), run with the repo's own package manager
   (pnpm/yarn/npm, detected from its lockfile).
3. A repo with no runnable script is **skipped with a notice** — so a library in
   the workspace doesn't block the services. If nothing is runnable, `dev` errors.

## Examples

```bash
nemus dev                          # every runnable repo in the current workspace
nemus dev payments --only web,api   # just a subset
nemus dev payments --command "make run"
nemus dev payments --exit-on-failure
```

## Notes

- Long-running: it stays in the foreground hosting the servers until they exit or
  you Ctrl-C. Not for scripting — use `nemus run` for one-shot commands.
- Each service runs in its own process group; shutdown SIGTERMs the group, then
  SIGKILLs stragglers after `--kill-timeout`, so nothing is orphaned.
- **Platform:** clean process-group teardown is POSIX (macOS/Linux). On Windows
  it falls back to `taskkill /T /F` (force-kill the tree, no graceful phase).
- `--kill-timeout 0` is honored (immediate SIGKILL after the SIGTERM).
