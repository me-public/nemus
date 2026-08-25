# Switch Branch

```bash
nemus branch switch --workspace <name> --branch <branch-name>
```

## Flags

| Flag | Short | Description |
|---|---|---|
| `--workspace <name>` | `-w` | Target workspace |
| `--branch <name>` | `-b` | Target branch name |

If some repos fail to switch (due to uncommitted changes), suggest:
- Committing or stashing changes first
- Using `nemus status <name>` to check the state
