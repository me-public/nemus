# Update Cache

Force refresh the GitHub repository cache so newly added repos become searchable.

## Instructions

1. Run:
   ```bash
   grove cache refresh
   ```
   Or use the short flag on any command:
   ```bash
   grove cache list --force-refresh
   ```

2. Report the result (number of repos cached, etc.).

3. Suggest using `grove cache search <query>` or `grove cache list` to browse the updated list.

## Success Criteria

- Cache is refreshed and the updated repo count is reported.
