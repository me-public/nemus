# Suite Use

1. In interactive mode:
   ```bash
   nemus suite use
   ```

2. In non-interactive mode (for agents):
   ```bash
   nemus suite use --suite <suite-name> --workspace <workspace-name> --yes
   ```

3. This will:
   - Clone all repos defined in the suite
   - Run any post-clone hooks configured in the suite
   - Set up Claude Code integration

4. After creation, suggest `nemus status <workspace>` to verify.
