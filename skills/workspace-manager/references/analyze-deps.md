# Analyze Dependencies

Analyze inter-repository dependencies within a workspace and detect circular dependencies.

## Instructions

```bash
nemus analyze-deps <workspace>
```

Alias:
```bash
w ad <workspace>
```

Without a workspace name, prompts interactively:
```bash
nemus analyze-deps
```

## What It Analyzes

- `package.json` dependencies (npm packages that match workspace repo names)
- `Dockerfile` references
- `docker-compose.yml` service references

## Output

- **Dependency graph** — which repos depend on which
- **Circular dependencies** — cycles detected with explanation
- **Missing dependencies** — repos referenced but not in the workspace
- **Mermaid diagram** — visual dependency graph
- Optionally saves analysis to workspace metadata

## Suggested Follow-ups

- Missing dependencies: `nemus update --workspace <name> --repos <missing>` to add them
- Circular dependencies: explain resolution strategies
- For documentation: `nemus generate-docs <name>` to include the dependency graph

## Success Criteria

- Dependency analysis is presented with per-repo dependency lists.
- Circular dependencies are highlighted if detected.
- Missing repos are identified.
