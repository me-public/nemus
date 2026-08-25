# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-08-24

### Security

- **Fixed a path-traversal vulnerability in the MCP server.** The MCP tool
  handlers built filesystem paths (`path.join(WORKSPACES_DIR, workspace)`)
  directly from the caller-supplied `workspace` argument with no validation, so
  an MCP client could pass a value like `../../etc` to read, write, delete
  (`delete-workspace`), or run commands (`run-command`) **outside** the
  workspaces directory. All handlers now resolve workspace paths through a new
  `safeWorkspacePath()` choke point that enforces an allowlist
  (`^[A-Za-z0-9_-]+$`) **and** verifies the resolved path stays inside
  `WORKSPACES_DIR`. The MCP input schemas additionally reject traversal
  characters at the boundary (defense in depth). The archive/unarchive metadata
  paths are hardened the same way.

## [0.2.0] - 2026-08-24

### Added

- **Investigate-first workspaces.** When `nemus -- "<prompt>"` doesn't name
  concrete repos but asks the agent to figure out which repos are relevant (from
  a trace, stack trace, or log search), Nemus now creates an **empty** workspace
  and seeds the in-session agent with a discover-then-add workflow: it
  investigates, maps services to repos (MCP `search-repos` when available, else
  the `gh` CLI, honouring a configured org), adds them with `nemus update`, and
  only then reads the code.
- `nemus create --allow-empty` creates a zero-repo workspace that still writes
  the agent context + `.mcp.json`, so the agent lands with the tools to discover
  and add repos.

### Changed

- `nemus update` (CLI and MCP) regenerates the agent context after a successful
  add, so a freshly-populated workspace stops reporting "0 repositories."
- Context regeneration now **preserves operator-authored `## Notes`** instead of
  overwriting them.
- Shell integration probes installed agents (claude → pi → opencode → codex →
  gemini) when `primaryAgent=auto`, instead of assuming `claude`.

### Fixed

- Extraction now coerces malformed model output (wrong field types) to safe
  empties instead of throwing.
- Corrected internal command references that still invoked the pre-rename `w`
  binary; they now use `nemus`.

## [0.1.0] - 2026-08-24

Initial open-source release of **Nemus**.

### Added

- Multi-repository **workspaces**: create, list, update, delete, and jump to
  folders of related Git repositories.
- Bulk operations across every repo in a workspace: `status`, `sync`, `diff`,
  `run`, and `doctor` (health checks + score).
- **Branch operations** (switch/create/merge/rebase) across all repos.
- **Suites** — reusable repo collections with optional post-clone hooks, plus
  export/import.
- **Snapshots** — capture and restore exact workspace state.
- **Cache** management for the GitHub repo list.
- **Dependency analysis** and **doc generation** across a workspace.
- **AI-agent integration** for Claude Code, pi, OpenCode, Codex, and Gemini:
  generated context files, skills installation, hooks (where supported), and an
  **MCP server** (`nemus-mcp`).
- Provider-agnostic by design — works with whatever model provider your agent
  supports (Anthropic, OpenAI, Google, or Amazon Bedrock).
- Natural-language front door: `nemus -- "<prompt>"`.
- Interactive TUI and a multi-agent dashboard.
- Automatic retries with backoff on flaky network operations.
- Optional shell integration (auto-cd on create + quick-navigate helper).

[Unreleased]: https://github.com/me-public/nemus/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/me-public/nemus/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/me-public/nemus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/me-public/nemus/releases/tag/v0.1.0
