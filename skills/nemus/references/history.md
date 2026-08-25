# History

```bash
nemus history
nemus history show 50           # last 50 records
nemus history show --command create   # filter by command
nemus history show --workspace my-ws  # filter by workspace
```

```bash
nemus history stats
```

Shows total operations, success rate, average duration, and per-command usage counts.

```bash
nemus history clear
nemus history clear --yes    # skip confirmation
```

```bash
w h              # same as nemus history
w h stats        # same as nemus history stats
```
