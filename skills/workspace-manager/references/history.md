# History

View operation history for workspace-manager commands.

## Instructions

### Show Recent History

```bash
grove history
grove history show 50           # last 50 records
grove history show --command create   # filter by command
grove history show --workspace my-ws  # filter by workspace
```

### Show Statistics

```bash
grove history stats
```

Shows total operations, success rate, average duration, and per-command usage counts.

### Clear History

```bash
grove history clear
grove history clear --yes    # skip confirmation
```

## Alias

```bash
w h              # same as grove history
w h stats        # same as grove history stats
```

## Success Criteria

- History records are displayed in a table with timestamp, command, workspace, duration, and status.
- Stats show meaningful aggregations.
