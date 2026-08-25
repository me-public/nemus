# Generate Docs

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

Creates these files in the workspace root:
- `WORKSPACE-README.md` — Overview of the workspace and its repos
- `DEPENDENCY-GRAPH.md` — Mermaid diagram of inter-repo dependencies
- `REPOSITORY-INDEX.md` — Detailed index of all repos
