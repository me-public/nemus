# `nemus dev` — multi-repo dev orchestrator

## Problem

A workspace is a set of services you run *together* (frontend + backend +
worker…), but starting them means opening N terminals and running the right
`npm run dev` in each — then remembering to kill them all. `nemus run` is
one-shot (spawn, wait, collect); it can't host long-lived dev servers with live,
interleaved output.

## Solution

`nemus dev [workspace]` — start every repo's dev server at once, stream their
output into one terminal with a **color-coded, aligned per-repo prefix**, and
tear them all down cleanly on a single Ctrl-C.

```
nemus dev payments
web      | VITE ready in 412 ms
api      | listening on :4000
worker   | [queue] connected
```

## Command detection (per repo)

1. `--command "<cmd>"` — explicit override, run in every selected repo.
2. Else read `package.json` `scripts` and pick the first that exists:
   `--script <name>` (if given) → `dev` → `develop` → `start` → `serve`.
   The runner is the repo's package manager, detected from its lockfile
   (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm).
3. A repo with no runnable script is **skipped with a notice** (not an error) —
   a workspace often mixes runnable services with libraries.

If nothing is runnable, `dev` exits with a helpful message.

## Process handling

- Each service is spawned with `shell: true` (so `npm run dev` and arbitrary
  `--command` strings work) and **`detached: true`** so it gets its own process
  group; on shutdown we signal the whole group (`process.kill(-pid, …)`) so
  child trees (the dev server's own subprocesses) die too — the #1 orchestrator
  footgun.
- stdout/stderr are line-buffered and written with `"<label> | "` prefixes;
  partial lines are held until the newline so prefixes never split a line.
- **One Ctrl-C stops everything:** SIGINT/SIGTERM → SIGTERM every group, wait a
  grace period (`--kill-timeout`, default 5s), then SIGKILL stragglers, then
  exit. A second Ctrl-C escalates immediately.
- A service that exits on its own is reported (`[label] exited (code N)`), and by
  default the rest keep running; `--exit-on-failure` tears everything down when
  any service exits non-zero. `dev` returns the first non-zero child code (or 0).

## Flags

| Flag | Meaning |
| --- | --- |
| `--only <repos>` | comma-separated subset of repos to start |
| `--script <name>` | npm script to prefer (default: dev → develop → start → serve) |
| `--command "<cmd>"` | run this exact command in every selected repo instead of a script |
| `--exit-on-failure` | tear everything down if any service exits non-zero |
| `--kill-timeout <s>` | grace period before SIGKILL on shutdown (default 5) |

## Testable surface (`src/utils/dev-orchestrator.ts`)

Pure/unit-tested: `detectPackageManager`, `pickDevScript`, `resolveDevCommand`,
`assignColors`, `formatPrefix`, and the line-splitter. The spawn/multiplex loop
(`runDev`) is integration-tested with a short-lived fake process (start → emit a
line → get SIGTERM → exit).

## Out of scope (follow-ups)

- `Procfile` / `Procfile.dev` parsing.
- A committed per-workspace `dev` config (which services, order, ready-regexes).
- Readiness/health gating and start-order dependencies.
