# Go (Navigate to Workspace)

Quickly navigate to a workspace directory. Works with the `nemgo` shell function for auto-CD.

## Instructions

With a known workspace name:
```bash
nemus go <name>
```

Without a name (interactive fuzzy picker):
```bash
nemus go
```

Or use the shell function (auto-CDs into the workspace):
```bash
nemgo <name>
```

The `nemgo` variant also launches Claude Code automatically if a session exists.

## How It Works

1. `nemus go` writes the workspace path to `~/.workspace-last-go`
2. The shell integration function reads that file and runs `cd`
3. If the workspace has an existing Claude session, it resumes it

