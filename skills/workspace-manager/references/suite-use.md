# Suite Use

Create a new workspace from a saved suite.

## Instructions

1. In interactive mode:
   ```bash
   grove suite use
   ```

2. In non-interactive mode (for agents):
   ```bash
   grove suite use --suite <suite-name> --workspace <workspace-name> --yes
   ```

3. This will:
   - Clone all repos defined in the suite
   - Run any post-clone hooks configured in the suite
   - Set up Claude Code integration

4. After creation, suggest `grove status <workspace>` to verify.

## Success Criteria

- Workspace is created with all suite repos cloned.
- Post-clone hooks (if any) are executed.
