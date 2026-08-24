# Suite Delete

Delete a saved suite.

## Instructions

1. In interactive mode:
   ```bash
   nemus suite delete
   ```

2. In non-interactive mode (for agents):
   ```bash
   nemus suite delete --name <suite-name> --yes
   ```

3. Confirm deletion.

## Success Criteria

- Suite is removed and no longer appears in `nemus suite list`.
