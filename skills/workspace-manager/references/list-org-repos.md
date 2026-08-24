# List Org Repos

List all organization repositories from GitHub.

## Instructions

1. Run:
   ```bash
   grove cache list
   ```
   Pass `--force-refresh` (or `-f`) only if the user explicitly asks to refresh the cache:
   ```bash
   grove cache list --force-refresh
   ```

2. Present the repos in a clear format. Since there may be many, consider:
   - Grouping by prefix (api-, service-, lib-, etc.)
   - Showing count totals
   - Asking the user to narrow down with `grove cache search <query>` if needed

3. If the cache is stale, suggest `grove cache refresh` to update it.

## Success Criteria

- All org repos are listed, optionally grouped by prefix.
- User is guided toward `grove cache search` if the list is too large to browse.
