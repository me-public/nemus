# restore

Recreate a workspace from a `nemus.lock` (see [`lock`](lock.md)) on any machine:
clones every repo and checks out the recorded branch, then writes metadata +
agent context exactly like `create`.

## CLI

```bash
nemus restore [lockfile] [options]
```

- `[lockfile]` — path to a `nemus.lock`; omitted, uses `./nemus.lock`. Use `-`
  to read the lockfile from stdin.
- `-w, --workspace <name>` — override the workspace name baked into the lockfile
  (also used to resolve a name clash).
- `--pin` — check out the exact recorded commit for each repo instead of the
  branch tip.
- `-y, --yes` — non-interactive (skips the post-restore agent launch).

## Examples

```bash
nemus restore                          # from ./nemus.lock
nemus restore cf.lock                    # from a specific file
nemus restore cf.lock -w experiment      # into a differently-named workspace
nemus restore cf.lock --pin              # reproduce exact commits, not branch tips
cat cf.lock | nemus restore -            # from stdin
```

## Notes

- URLs are rebuilt for the restorer's `cloneProtocol` (https/ssh) using the
  locked host + owner + name, so an ssh-locked workspace restores fine for an
  https user.
- If a recorded branch no longer exists on the remote, restore falls back to the
  recorded commit and warns.
- Name clashes auto-resolve to a suffixed name (same as `create`).
- Needs GitHub auth for private repos (warns if `gh` is unauthenticated).
