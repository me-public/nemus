# lock

Snapshot a workspace into a committable `nemus.lock` — the repos, each repo's
owner + directory name + clone URL, the branch it's currently on, and its HEAD
commit. Share the file (commit it, drop it in a ticket) and anyone recreates the
exact workspace with [`restore`](restore.md).

## CLI

```bash
nemus lock [workspace] [options]
```

- `[workspace]` — workspace name; omitted, resolves the current/default one.
- `-o, --output <file>` — write to `<file>` instead of `<workspace>/nemus.lock`.
  Use `-o -` to print the lockfile JSON to stdout (pipe/redirect it anywhere).
- `--all` — write a `nemus.lock` into **every** workspace (makes a whole machine
  portable in one shot). Skips workspaces that already have a lockfile unless
  `--force` is given. Cannot be combined with `--output`. This is the explicit
  alternative to a hidden snapshot side effect in `migrate`.

## Examples

```bash
nemus lock                       # write ./nemus.lock into the current workspace
nemus lock checkout-flow          # snapshot a named workspace
nemus lock checkout-flow -o cf.lock
nemus lock checkout-flow -o - | pbcopy   # copy the manifest to the clipboard
nemus lock --all                 # lock every workspace (skips existing lockfiles)
nemus lock --all --force          # …and overwrite existing ones
```

## Notes

- Repos whose original clone failed are skipped.
- A repo on a detached HEAD records only its commit (no branch).
- The lockfile contains only what `git remote -v` already exposes — safe to commit.
- Distinct from `snapshot` (local time-travel) and `suite` (reusable template).
