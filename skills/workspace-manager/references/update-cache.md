# Update Cache

Force refresh the GitHub repository cache so newly added repos become searchable.

## Instructions

1. Run:
   ```bash
   nemus cache refresh
   ```
   Or use the short flag on any command:
   ```bash
   nemus cache list --force-refresh
   ```

2. Report the result (number of repos cached, etc.).

3. Suggest using `nemus cache search <query>` or `nemus cache list` to browse the updated list.

## Success Criteria

- Cache is refreshed and the updated repo count is reported.
