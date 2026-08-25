# Suite Create

Create a new suite (reusable collection of repositories) that can be used to quickly set up workspaces.

## Instructions

1. In interactive mode:
   ```bash
   nemus suite create
   ```

2. In non-interactive mode (for agents):
   ```bash
   nemus suite create --name <suite-name> --repos repo1,repo2,repo3 --description "optional description" --yes
   ```

3. After creation, confirm with the suite name and repo count.

