# Branch Merge

Merge a source branch into a target branch across all repositories in a workspace.

## Instructions

1. Run:
   ```bash
   nemus branch merge <workspace> <source-branch> <target-branch> [--no-ff|--ff-only|--squash]
   ```

2. Present results per repo:
   - Which repos merged successfully
   - Which repos failed (e.g., conflicts)
   - Summary count

3. If there are merge conflicts, suggest the user resolve them manually in the affected repos.

## Success Criteria

- Merge is attempted in all repos.
- Results are reported per repo with success/failure status.
