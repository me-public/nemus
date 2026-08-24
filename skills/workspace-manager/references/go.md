# Go (Navigate to Workspace)

Quickly navigate to a workspace directory. Works with the `gvgo` shell function for auto-CD.

## Instructions

With a known workspace name:
```bash
grove go <name>
```

Without a name (interactive fuzzy picker):
```bash
grove go
```

Or use the shell function (auto-CDs into the workspace):
```bash
gvgo <name>
```

The `gvgo` variant also launches Claude Code automatically if a session exists.

## How It Works

1. `grove go` writes the workspace path to `~/.workspace-last-go`
2. The shell integration function reads that file and runs `cd`
3. If the workspace has an existing Claude session, it resumes it

## Success Criteria

- The terminal's working directory changes to the workspace path.
- If a Claude session exists, it resumes automatically (with `gvgo`).
