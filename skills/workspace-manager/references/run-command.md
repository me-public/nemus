# Run Command

Run a shell command across all repositories in a workspace (3 concurrent, 5 minute timeout per repo).

## Instructions

```bash
grove run <workspace> <command>
```

Alias:
```bash
w r <workspace> <command>
```

Without a workspace name, prompts interactively:
```bash
grove run "<command>"
```

## Examples

```bash
grove run my-workspace "npm install"
grove run my-workspace "git status -s"
grove run my-workspace "npm test"
grove run my-workspace "echo hello"
grove run my-workspace "git checkout main"
grove run my-workspace "cat package.json | jq .version"
```

## Output

Shows per-repo results:
- ✓ for successful execution (with stdout)
- ✗ for failed execution (with stderr)
- Summary count of successes and failures

Exits with code 1 if any repo failed.

## Success Criteria

- Command is executed in all repos and per-repo success/failure is reported.
- stdout and stderr from each repo are clearly displayed.
