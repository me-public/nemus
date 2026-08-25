# Workspace Doctor

1. If no workspace is specified, run `nemus list` and ask which one.

2. Run:
   ```bash
   nemus doctor <name>
   ```

3. Present the health report:
   - Overall health score (0-100)
   - Individual check results (pass/fail/warning)
   - Specific recommendations for any issues found

4. For low scores, suggest fixes:
   - `nemus sync` for outdated repos
   - `nemus cleanup` for disk space issues
   - `nemus branch create` or `nemus branch switch` for branch inconsistencies
