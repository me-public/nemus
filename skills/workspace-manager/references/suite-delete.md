# Suite Delete

Delete a saved suite.

## Instructions

1. In interactive mode:
   ```bash
   grove suite delete
   ```

2. In non-interactive mode (for agents):
   ```bash
   grove suite delete --name <suite-name> --yes
   ```

3. Confirm deletion.

## Success Criteria

- Suite is removed and no longer appears in `grove suite list`.
