# AGENTS.md

This file gives AI coding agents (Claude Code, Cursor, pi, and others) the
context they need to work productively in this repository. If you are an agent,
read this before making changes. If you are a human, this doubles as a quick
orientation to the codebase.

## What Grove is

Grove is a **TypeScript CLI for managing multi-repo development workspaces**. It
clones a set of Git repositories into a single workspace directory, then lets you
operate across all of them at once — check status, sync, switch branches, run
commands, analyze cross-repo dependencies, and more — with one command instead of
looping over each repo by hand.

Grove also integrates with AI coding agents. It can generate per-workspace
context, register an MCP server, and hand a freshly created workspace off to your
agent of choice. Supported agents include **Claude Code, pi, OpenCode, Codex, and
Gemini**.

The CLI is invoked as **`grove`** (with **`gv`** as a short alias). A shell
integration adds `grove`/`gv` functions plus a `gvgo` helper so the shell can
auto-`cd` into a workspace after create/list/go commands (a child process cannot
change its parent shell's directory, so this is done via shell functions).

## Repository layout

```
bin/            # CLI entry point (bin/workspace.js) — mapped to `grove` and `gv`
src/
  program.ts    # Commander program: wires up all commands and flags
  commands/     # One module per command (create, list, sync, status, branch/, suite/, cache/, …)
  utils/        # Shared helpers: config, workspace metadata, git, cache, agent config
  mcp/          # MCP server + installer (server.ts, install.ts, tools.ts)
  cli/          # Interactive TUI and AI-prompt entry points
  pi-extensions/# pi extension templates copied into dist on build
  scripts/      # Helper scripts bundled into dist
  types/        # Shared TypeScript types
skills/         # Agent skill docs (Markdown) installed into agent skill dirs
assets/         # Logos and imagery
scripts/        # postinstall + build-time scripts
install*.sh, uninstall.sh, sync-permissions.sh   # Install / shell-integration scripts
```

Tests live next to the code they cover as `*.test.ts` files and run under Vitest.

## Building and testing

```bash
npm install        # install dependencies
npm run build      # compile TypeScript to dist/ (also copies runtime assets)
npm test           # run the Vitest suite
npm run typecheck  # type-check without emitting
```

There is also a shell-level test for the shell integration:

```bash
bash shell-integration.test.sh
```

Requirements: **Node.js >= 22** and **npm >= 9**. Grove shells out to `git` and
the GitHub CLI (`gh`) at runtime, and optionally uses `ghq` for faster clones.

## Coding conventions

- **Match the existing style.** There is no enforced formatter or lint step, so
  follow the conventions already present in the file you are editing (quote style,
  spacing, import ordering). Do not reformat unrelated lines — it buries the real
  change in noise.
- **TypeScript, ES modules, Node built-ins.** Keep dependencies lean; prefer the
  standard library and the packages already in `package.json`.
- **Commands are self-contained.** Each file in `src/commands/` implements one
  command and registers it via `program.ts`. Put shared logic in `src/utils/`.
- **Add tests for behavior changes.** Co-locate a `*.test.ts` next to the code and
  make sure `npm test` passes before opening a PR.
- **Keep it vendor-neutral and local-first.** Grove is an open-source,
  general-purpose tool that runs entirely on the developer's machine:
  - No remote-execution or hosted-infrastructure code — everything runs locally.
  - No references to any specific company, internal service, or private tooling.
  - Use generic, illustrative names in docs and examples (e.g. `your-org`,
    `payments`, `api`), never real internal org or repo names.
- **User-facing text says "Grove".** The npm package is `grove-cli`; the commands
  are `grove` and `gv`; the repo is `grove-cli/grove`.

## How agents should work here

1. Read this file and the relevant `src/commands/` or `src/utils/` module before
   editing.
2. Make focused changes; run `npm run build` and `npm test` locally.
3. Keep documentation (`README.md`, `skills/`) in sync when you change behavior.
4. Prefer small, reviewable pull requests with a clear description of the change.
