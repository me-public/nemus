# GHQ Status

```bash
nemus ghq-status
```

- Whether ghq is installed
- ghq root directory and number of managed repos
- How ghq accelerates workspace creation (cached local copies)

1. **First clone**: ghq downloads repo to its cache
2. **Workspace creation**: Copies from ghq cache instead of cloning from remote
3. **Subsequent clones**: Much faster (local copy vs network clone)
4. **Isolation**: Each workspace still gets its own independent clone
