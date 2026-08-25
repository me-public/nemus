# Branch Rebase

Rebase all repositories in a workspace onto a target branch.

## Instructions

1. Run:
   ```bash
   nemus branch rebase <workspace> <target-branch>
   ```

2. Present results per repo:
   - Which repos rebased successfully
   - Which repos failed (e.g., conflicts)
   - Summary count

3. If there are rebase conflicts, suggest the user resolve them manually in the affected repos.

