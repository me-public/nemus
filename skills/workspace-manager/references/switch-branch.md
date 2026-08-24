# Switch Branch

Switch all repositories in a workspace to a specified branch.

## Instructions

```bash
grove branch switch --workspace <name> --branch <branch-name>
```

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Target workspace |
| `--branch <name>` | `-b` | Target branch name |

If some repos fail to switch (due to uncommitted changes), suggest:
- Committing or stashing changes first
- Using `grove status <name>` to check the state

## Success Criteria

- All repos without uncommitted changes are switched to the target branch.
- Repos that failed to switch are clearly reported with the reason.
