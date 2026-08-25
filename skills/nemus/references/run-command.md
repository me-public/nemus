# Run Command

Run a shell command across all repositories in a workspace (3 concurrent, 5 minute timeout per repo).

## Instructions

```bash
nemus run <workspace> <command>
```

Alias:
```bash
nem r <workspace> <command>
```

Without a workspace name, prompts interactively:
```bash
nemus run "<command>"
```

## Examples

```bash
nemus run my-workspace "npm install"
nemus run my-workspace "git status -s"
nemus run my-workspace "npm test"
nemus run my-workspace "echo hello"
nemus run my-workspace "git checkout main"
nemus run my-workspace "cat package.json | jq .version"
```

## Output

Shows per-repo results:
- ✓ for successful execution (with stdout)
- ✗ for failed execution (with stderr)
- Summary count of successes and failures

Exits with code 1 if any repo failed.

