# Branch Create

Create a new branch across all repositories in a workspace.

## Instructions

```bash
nemus branch create --workspace <name> --branch <branch-name>
nemus branch create --workspace <name> --branch <branch-name> --base <base-branch>
```

Or with positional args (legacy):
```bash
nemus branch create <workspace> <branch-name>
nemus branch create <workspace> <branch-name> --base <base-branch> --force
```

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Target workspace |
| `--branch <name>` | `-b` | New branch name |
| `--base <branch>` | | Base branch to create from (default: current branch) |
| `--force` | | Force create even if branch exists |

After creation, run `nemus status <name>` to verify all repos are on the new branch.

## Success Criteria

- New branch is created in all repos and per-repo results are reported.
