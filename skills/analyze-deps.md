---
name: analyze-deps
description: Analyze inter-repository dependencies in a workspace
---

# Analyze Dependencies

Analyze inter-repository dependencies in a workspace.

## Running

```bash
nemus analyze-deps <workspace-name>
```

Or for the current workspace:
```bash
nemus analyze-deps
```

## Presenting Results

Report dependency relationships between repos (which repos depend on which via package.json).
