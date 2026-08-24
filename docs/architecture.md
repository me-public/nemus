# Architecture

Nemus is a TypeScript CLI compiled to CommonJS and run on Node 22+. This doc is a
map of the codebase for contributors.

## Entry points

- **`bin/workspace.js`** — the launcher behind the `nemus` and `nem` binaries. It
  handles `--version`/`--help` without a build, does best-effort update &
  hook-repair checks, intercepts the `nemus -- "<prompt>"` natural-language path,
  and otherwise delegates to Commander.
- **`src/program.ts`** — builds the Commander program and registers every command.
- **`src/mcp/server.ts`** — the `nemus-mcp` Model Context Protocol server, exposing
  Nemus's operations as MCP tools for agents that support them.

## Commands (`src/commands/`)

Each command is a module exporting a `register…Command(program)` function. Grouped
commands (`suite`, `branch`, `cache`) live in their own subfolders and register a
parent command with subcommands. The multi-agent TUI lives in
`src/commands/dashboard/` and `src/cli/dashboard/` (Ink/React).

Notable commands: `create`, `list`, `update`, `delete`, `sync`, `status`, `diff`,
`run`, `go`, `doctor`, `branch`, `suite`, `snapshot` (via cache/meta), `cleanup`,
`remove-repo`, `history`, `sessions`, `analyze-deps`, `generate-docs`, `configure`,
`migrate`, `report-bug`.

## Utilities (`src/utils/`)

The shared engine. Highlights:

- **`config.ts`** — user config (`~/.workspace-manager-cache/config.json`) +
  environment overrides, and the agent-type unions.
- **`agent-config.ts`** — the **agent registry**. Each supported agent (Claude
  Code, pi, OpenCode, Codex, Gemini) is an `AgentPaths` entry describing its
  skills dir, settings file, context filename, launch/resume commands, and MCP/
  hooks support. `AGENT_ORDER` controls detection & display order. **Add a new
  agent here** and everything else (context files, skills, dashboards) follows.
- **`github.ts`** — repo discovery via the `gh` CLI (cached).
- **`git-operations.ts` / `git-status.ts` / `branch-operations.ts` /
  `sync-operations.ts` / `diff-operations.ts`** — the per-repo git work.
- **`workspace-meta.ts` / `context-file.ts`** — workspace metadata and generated
  agent context files.
- **`permission-sync.ts`** — installs/repairs agent hooks, skills, and status
  lines (Claude Code settings format).
- **`retry.ts`, `cache.ts`, `health-checks.ts`, `dependency-analyzer.ts`,
  `doc-generator.ts`** — reliability, caching, doctor, deps, and docs.

## MCP (`src/mcp/`)

`server.ts` registers tools; `tools.ts` implements the handlers (create/update
workspaces, search repos, status, cleanup, branch ops, …); `install.ts` wires the
server into each MCP-capable agent's config.

## Types (`src/types/`)

Shared interfaces (`GitHubRepo`, `WorkspaceMetadata`, `DependencyInfo`, Ink type
shims, …).

## Skills (`skills/`)

Markdown skill definitions installed into each active agent's skills directory so
agents can drive Nemus with high-level intents.

## Build

`npm run build` runs `tsc` then copies a few non-TS assets (`sidebar.js`,
`pi-extensions/`, `scripts/`) into `dist/`. Output is CommonJS in `dist/`.

## Testing

Vitest, with `*.test.ts` files colocated next to the code. Some tests shell out or
touch the filesystem, so the suite uses a generous timeout (see
`vitest.config.ts`). Run `npm test`.

## Design principles

- **Local-first.** No hosted/cloud/server components.
- **Vendor-neutral.** No hard-coded orgs, private URLs, or internal services.
- **Agent-agnostic.** Integrations are optional and auto-detected via the registry.
