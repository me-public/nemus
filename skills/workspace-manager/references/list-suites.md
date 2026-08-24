# List Suites

List all saved suites with their repo counts.

## Instructions

```bash
grove suite list
```

Present the suites showing name, number of repos, description (if available), and repo list.

To create a workspace from a suite (non-interactive):
```bash
grove suite use --suite <suite-name> --workspace <workspace-name> --yes
```

## Success Criteria

- All available suites are listed with their repo counts and descriptions.
- User is guided toward `grove suite use` if they want to create a workspace from a suite.
