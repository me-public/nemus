---
name: analyze-deps
description: Analyze inter-repository dependencies in a workspace
---

# Analyze Dependencies

Analyze inter-repository dependencies in a workspace.

## Running

```bash
grove analyze-deps <workspace-name>
```

Or for the current workspace:
```bash
grove analyze-deps
```

## Presenting Results

Report dependency relationships between repos (which repos depend on which via package.json).
