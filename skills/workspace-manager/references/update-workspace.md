# Update Workspace

Add more repositories to an existing workspace.

## Instructions

1. Run the command with flags (non-interactive):
   ```bash
   nemus update --workspace <name> --repos <r1,r2,...>
   ```

   Or interactively:
   ```bash
   nemus update
   ```

2. Report which repos were added successfully and which were skipped (already exist).

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Target workspace |
| `--repos <r1,r2,...>` | `-r` | Comma-separated repo names to add. Use `repo:suffix` to add the same repo again under a separate folder. |

## Adding the same repo more than once (instances)

The same repository can live in a workspace multiple times under different
folders — useful for comparing branches/versions side by side, or keeping a
second checkout instead of a `git worktree` (which `nemus status`/`nemus sync` do NOT
track). Append `:suffix` to the repo name; the repo is cloned into
`<repo>-<suffix>`:

```bash
# casper already in the workspace — add a second checkout for branch CAS-101
nemus update --workspace my-ws --repos casper:cas-101    # -> folder casper-cas-101
```

The suffix may contain letters, numbers, hyphens, and underscores. Each
instance is tracked independently by `nemus status` and `nemus sync` and is labeled
`(instance: <folder>)` in the workspace context file.

> Do NOT use `git worktree` inside a workspace to get a second checkout of a
> tracked repo — worktrees are invisible to `nemus status`/`nemus sync`. Use
> `nemus update --repos <repo>:<suffix>` instead.

## Success Criteria

- All specified repos are cloned into the workspace.
- User is informed of any repos skipped due to already existing.
