# GHQ Status

Check the status of ghq integration for faster repository cloning.

## Instructions

```bash
nemus ghq-status
```

## What It Shows

- Whether ghq is installed
- ghq root directory and number of managed repos
- How ghq accelerates workspace creation (cached local copies)

## How ghq Works with Workspace Manager

1. **First clone**: ghq downloads repo to its cache
2. **Workspace creation**: Copies from ghq cache instead of cloning from remote
3. **Subsequent clones**: Much faster (local copy vs network clone)
4. **Isolation**: Each workspace still gets its own independent clone

## When to Suggest

- User reports slow workspace creation
- User asks about optimizing clone performance
- User asks what ghq is or whether to install it
