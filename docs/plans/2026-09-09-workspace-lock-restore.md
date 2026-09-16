# Portable workspaces: `nemus lock` / `nemus restore`

## Problem

A workspace today is reproducible only by whoever created it (its
`.workspace-meta.json` lives inside the workspace dir and records the repos, but
not the branch each repo is on, and there is no one-command way for a teammate
to recreate the exact set). Sharing "the workspace I'm working in" means telling
someone the repo list and branches by hand.

## Solution

A small, **committable** manifest — `nemus.lock` — plus two commands:

- **`nemus lock [workspace]`** — snapshot the workspace into `nemus.lock`
  (repos + owner + directory name + clone URL + the branch each repo is
  currently on, and its HEAD commit). Write it to the workspace root by default,
  or to `-o <file>` / stdout (`-o -`).
- **`nemus restore [lockfile]`** — recreate the workspace from a `nemus.lock`
  (defaults to `./nemus.lock`, or `-` for stdin): clone every repo and check out
  the recorded branch. `--pin` checks out the exact recorded commit instead.

This is "a Brewfile for workspaces": commit `nemus.lock` alongside a design doc
or drop it in a ticket, and a teammate runs `nemus restore` to land in the
identical multi-repo setup.

## Lockfile format (`nemus.lock`, JSON, version 1)

```json
{
  "version": 1,
  "workspace": "checkout-flow",
  "generatedAt": "2026-09-09T10:00:00.000Z",
  "repositories": [
    {
      "name": "web",
      "owner": "acme",
      "directoryName": "web",
      "cloneUrl": "git@github.com:acme/web.git",
      "branch": "feat/checkout",
      "commit": "a1b2c3d"
    }
  ]
}
```

- `branch` is the repo's current branch at lock time (omitted for a detached
  HEAD — restore falls back to the commit).
- `commit` is the short HEAD SHA, used by `--pin` (and as the fallback when the
  branch no longer exists on the remote).

## Design decisions

- **Honor the restorer's protocol.** The lock stores the resolved `cloneUrl`,
  but restore rebuilds `https`/`ssh` URLs for the *same host + owner + name* and
  lets `getCloneUrl` pick per the restorer's `cloneProtocol` config (falling
  back to the stored URL if the host can't be parsed) — so an ssh-locked
  workspace restores fine for an https user.
- **Reuse the create pipeline.** Restore feeds reconstructed `GitHubRepo`s into
  the existing `cloneRepositories` (progress bar, ghq, concurrency, dedup), then
  does a per-repo branch checkout pass, then writes metadata + context exactly
  like `create`.
- **Name conflicts** resolve with the same `resolveWorkspaceNameConflict` used by
  `create`; `--workspace` overrides the name baked into the lock.
- **No secrets.** The lockfile contains only what `git remote -v` already
  exposes; safe to commit.

## Out of scope (follow-ups)

- MCP `lock`/`restore` tools (CLI-first for v1).
- Recording per-repo uncommitted diffs (the lock captures committed state only).
