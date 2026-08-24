# Generate Docs

Generate workspace documentation including a README, dependency graph, and repository index.

## Instructions

```bash
nemus generate-docs <workspace>
```

Alias:
```bash
w gd <workspace>
```

Without a workspace name, prompts interactively:
```bash
nemus generate-docs
```

## Generated Files

Creates these files in the workspace root:
- `WORKSPACE-README.md` — Overview of the workspace and its repos
- `DEPENDENCY-GRAPH.md` — Mermaid diagram of inter-repo dependencies
- `REPOSITORY-INDEX.md` — Detailed index of all repos

## When to Suggest

- After creating a workspace with many repos
- When user wants to understand workspace structure
- When onboarding someone to a multi-repo project

## Success Criteria

- All three documentation files are generated in the workspace directory.
