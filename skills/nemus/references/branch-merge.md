# Branch Merge

1. Run:
   ```bash
   nemus branch merge <workspace> <source-branch> <target-branch> [--no-ff|--ff-only|--squash]
   ```

2. Present results per repo:
   - Which repos merged successfully
   - Which repos failed (e.g., conflicts)
   - Summary count

3. If there are merge conflicts, suggest the user resolve them manually in the affected repos.
