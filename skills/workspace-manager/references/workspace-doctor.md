# Workspace Doctor

Run comprehensive health checks on a workspace and return a health score (0-100).

## Instructions

1. If no workspace is specified, run `grove list` and ask which one.

2. Run:
   ```bash
   grove doctor <name>
   ```

3. Present the health report:
   - Overall health score (0-100)
   - Individual check results (pass/fail/warning)
   - Specific recommendations for any issues found

4. For low scores, suggest fixes:
   - `grove sync` for outdated repos
   - `grove cleanup` for disk space issues
   - `grove branch create` or `grove branch switch` for branch inconsistencies

## Success Criteria

- Health score and per-check results are clearly presented.
- Actionable remediation steps are provided for any failures or warnings.
