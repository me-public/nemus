# Workspace Diff

Show diff summary (staged/unstaged file counts, insertions, deletions) for all repos in a workspace.

## Instructions

1. If no workspace is specified, run `nemus list` and ask which one.

2. Run:
   ```bash
   nemus diff
   ```
   Or target a specific workspace:
   ```bash
   nemus diff <name>
   ```

3. Present a clear summary showing per-repo:
   - Number of staged/unstaged files
   - Lines inserted/deleted
   - Which files changed

4. If the user wants full diff content, they can pipe through `less` or redirect to a file.

