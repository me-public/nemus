# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.6] - 2026-08-25

### Changed

- **Skills are now command-first ("one shot").** Each skill's body no longer
  restates its frontmatter `description` under a heading before the command — it
  leads straight with the command(s). Cut the skills corpus a further ~25%
  (~1724 → ~1300 lines) with no loss of actual guidance.
- Fixed an unclosed code fence in the `save-context` skill.

### Added

- `assets/social-preview.png` (1280×640) and `assets/avatar-500.png` (500×500)
  for the GitHub repo social preview and org/profile avatar.

## [0.2.5] - 2026-08-25

### Changed

- **Simplified the bundled skills.** Removed repetitive ceremony sections
  (`Success Criteria`, `Suggested Follow-ups`, `Presenting Results`, etc.) and
  slimmed the routing `SKILL.md`, cutting the skills corpus ~20% with no loss of
  actual guidance.
- **Removed the `workspace-manager` name from the code.** The bundled skill
  folder is now `skills/nemus/`, the MCP server registers as **`nemus`** (tools
  are `mcp__nemus__*`, `.mcp.json` key `nemus`), and internal state paths moved
  to `~/.nemus/*` / `~/.nemus-*`. The legacy `WORKSPACE_MANAGER_DIR` /
  `WORKSPACE_MANAGER_CACHE_DIR` env vars and the `~/.workspace-manager-cache`
  migration source are kept for backward compatibility.

### Security

- Hardened the CI version-bump reminder to skip fork PRs (whose read-only token
  can't post), confirming the workflows never expose secrets to forks:
  CI runs on `pull_request` (not `pull_request_target`) and `NPM_TOKEN` lives
  only in the push/dispatch-triggered, approval-gated release workflow.

## [0.2.4] - 2026-08-25

### Changed

- Dependencies: `commander` 14 → 15 (runtime); dev tooling `@types/node` 22 → 26
  and `vitest` 3 → 4.
- CI: pinned `actions/checkout` → v7, `actions/setup-node` → v7, and
  `actions/github-script` → v9, which clears the "Node.js 20 is deprecated"
  warnings on every run.

### Deferred

- `react` 18 → 19 is held: `ink` 5's bundled `react-reconciler` targets React 18
  internals, so React 19 needs the `ink` 7 major (a TUI-tested change).
- `inquirer` 8 → 14 and `inquirer-autocomplete-prompt` 2 → 3 are held: inquirer
  v9+ split into `@inquirer/prompts`, so this is a code migration, not a bump.
- `typescript` 7 is held: it removes `moduleResolution: node10`, requiring a
  `tsconfig` migration.

## [0.2.3] - 2026-08-25

### Fixed

- The one-time `~/.workspace-manager-cache` → `~/.nemus` migration no longer
  copies `last-version-check.json`. If the old (shared) path held another tool's
  update-check cache, inheriting it could make nemus report a wrong "latest"
  version until the entry expired; skipping it forces one fresh lookup instead.

## [0.2.2] - 2026-08-25

### Changed

- **Namespaced all cache/config/state under `~/.nemus`** (was
  `~/.workspace-manager-cache`). This avoids collisions with other tools that
  used the old generic path — which could, for example, make the update check
  report a wrong "latest" version.
- Environment overrides are now **`NEMUS_DIR`** and **`NEMUS_CACHE_DIR`**; the
  legacy `WORKSPACE_MANAGER_DIR` / `WORKSPACE_MANAGER_CACHE_DIR` names still work
  as fallbacks.
- On first run, existing state is **migrated automatically** from
  `~/.workspace-manager-cache` to `~/.nemus` (a non-destructive copy — the old
  directory is left intact).
- Published as the scoped package **`@nemus-cli/nemus`** (npm's similarity guard
  blocks the bare name `nemus`). The `nemus` / `nem` CLI commands are unchanged.

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

[Unreleased]: https://github.com/me-public/nemus/compare/v0.2.6...HEAD
[0.2.6]: https://github.com/me-public/nemus/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/me-public/nemus/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/me-public/nemus/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/me-public/nemus/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/me-public/nemus/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/me-public/nemus/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/me-public/nemus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/me-public/nemus/releases/tag/v0.1.0
