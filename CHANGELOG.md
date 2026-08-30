# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-08-30

### Fixed

- **`reflect` no longer hangs/times out — the real root cause was open stdin.**
  The judge was spawned with its **stdin left as an open pipe** (`execFile`'s
  default), so a stdin-reading agent like `pi` blocked forever waiting on input
  and the run died at the timeout — regardless of prompt size or model. The
  child now gets stdin `ignore` (async) / `input: ''` (sync) → immediate EOF,
  and a real run drops from *timeout* to **~40s**. Regression-tested with a
  stdin-reading child that would otherwise hang.

### Changed

- **`reflect` now does the analysis in code and hands the LLM only compact
  facts.** A new deterministic layer (`reflect-analyze.ts`) clusters recurring
  failures into normalized **signatures** (paths/numbers/hashes stripped) with
  counts + which workspaces they span, tallies tool usage, flags
  correction/retry loops, and lists workspaces missing a context file. The judge
  prompt is built from those aggregates, so it stays **~5KB regardless of how
  many workspaces** are analyzed (was ~25KB and growing), the call is faster and
  cheaper, less raw prompt text leaves your machine, and every recommendation is
  grounded in a real count. Output shape (`--json`, the report) is unchanged;
  `--dry-run` now shows the computed facts.

## [0.3.1] - 2026-08-30

### Fixed

- **`reflect` shows live progress instead of looking hung.** The gather phase
  prints a **per-workspace line** as each session is read (`✓ 1/3 my-workspace
  635 turns · 12 prompts · 13 failures`); the judge runs **async** behind a live
  spinner with elapsed seconds; the timeout is raised to 300s (overridable via
  `NEMUS_JUDGE_TIMEOUT_MS`) with an **actionable** message on timeout.

## [0.3.0] - 2026-08-27

### Added

- **`nemus reflect` (alias `retro`) — LLM-as-a-judge retrospective.** Analyzes
  your most recent workspaces (default 10) by reading their agent session
  transcripts, distilling the human prompts + tool failures + tools used, and
  asking your own configured agent (claude/pi/opencode — no API key of ours) to
  recommend concrete setup improvements: which **skills** to add and where,
  missing **AGENTS.md/context** rules, missing **connectivity/smoke tests**, and
  **prompt/workflow** habits to change — each with a priority and a concrete
  example snippet. Reads both Claude and pi transcript formats. Flags:
  `--limit <n>`, `--json` (structured report, same `{ok:false,error}` failure
  contract as the other JSON commands), and `--dry-run` (print the assembled
  corpus + judge prompt without calling the agent). Idea courtesy of
  **@lightpriest** — thank you for the great suggestion!

## [0.2.13] - 2026-08-27

### Added

- **Shell completions**: `nemus completion bash|zsh|fish` prints a completion
  script for that shell. Completes subcommands (names + aliases) and, for a
  workspace-scoped command, live **workspace names** — the script calls back
  into `nemus completion --workspaces`, so completions stay fresh without
  regenerating. Registered for both the `nemus` and `nem` binaries. Install e.g.
  `nemus completion zsh > "${fpath[1]}/_nemus"` (see README).

## [0.2.12] - 2026-08-27

### Added

- **`--json` for more read-only reporting commands**, extending 0.2.11's set
  (`list`/`status`/`doctor`) to `suite list`, `sessions`, and `analyze-deps`.
  Each emits exactly one JSON document to stdout (no tables, no interactive
  prompt): `suite list --json` (saved suites + entries), `sessions --json`
  (workspace sessions, list-only — no resume), `analyze-deps --json` (per-repo
  dependencies/dependents/missing + circular deps + suggested missing repos;
  requires an explicit workspace). `--json` errors are parseable
  `{ ok:false, error }` on stdout + exit 1, consistent with 0.2.11.

## [0.2.11] - 2026-08-27

### Added

- **`--json` output** for the read-only reporting commands `list`, `status`, and
  `doctor`. Emits exactly one JSON document to stdout (no table, no interactive
  prompt), so `nemus list --json | jq …` and CI/scripts get stable,
  machine-readable output. `status --json` / `doctor --json` require an explicit
  workspace name (they never prompt).

### Changed

- **stdout/stderr hygiene.** Diagnostic logs (info/success/error/warning/step)
  now go to **stderr**, leaving **stdout** for a command's actual data. This is
  what makes `--json` pipe cleanly and lets non-TTY consumers separate data from
  progress. Human-facing table/plain output is unchanged on stdout.

## [0.2.10] - 2026-08-27

### Security

- **Eliminated the shell-injection surface in git/shell operations.** Every
  `exec`/`execSync` call that interpolated a value into a shell string was
  migrated to `execFile`/argv (no shell). Most notably, the MCP `branch_create`
  and `switch_branch` tools built `git checkout -b <name>` by unquoted
  interpolation with no branch-name validation, so a crafted (but valid) git ref
  could run arbitrary commands; branch names are now passed as argv elements and
  can never be interpreted by a shell. Also migrated `ghq`/clone, workspace
  cleanup (`du`, `git clean`), disk-usage health checks, agent-availability
  probing, and the shell-integration/MCP installers.
- **`w delete` no longer deletes arbitrary directories.** The `--workspace` flag
  path validated names through `safeWorkspacePath()` (allowlist + containment)
  and skips unknown/invalid names instead of `fs.rm`-ing a guessed path; the
  interactive path is guarded the same way.

### Added

- **Monorepo (npm workspaces).** The repo is now an npm-workspaces monorepo:
  the published CLI stays at the root (`@nemus-cli/nemus`, unchanged) and new
  packages live under `packages/*`.
- **`@nemus-cli/cloud` (private, P1).** An optional, vendor-neutral cloud/IaC
  package — not required for local Nemus. Two seams so far: the **forge-auth**
  seam (`ForgeTokenSource`) with `pat` and a dependency-free `github-app` source
  that mints least-privilege, auto-refreshing installation tokens; and the
  **execution** seam (`Runner`/`Provisioner` + neutral `TaskSpec`/
  `TargetDescriptor`/`Capabilities` + a name registry) with an in-box
  **Docker runner** (needs no cloud account); a **`SecretSource`** seam
  (`env`/`dotenv`/`gh` + `resolveSecretsToEnv`); and a **`GitForge`** seam
  (`openPR`/`getChecks`/`comment`) with a dependency-free GitHub implementation;
  and the **in-image agent orchestrator** (runner-image env contract, versioned
  `result.json` schema, and `runAgentTask`: clone all → run the agent once over
  the workspace → open a PR per changed repo, with per-repo error isolation);
  the **OCI image + `nemus-cloud-agent` entrypoint** (a Dockerfile with node +
  git + gh + pi/claude); and the **provisioning** seam (P2, in progress): a
  generic `OpenTofuProvisioner` (delegates to `tofu`/`terraform`, maps a module's
  `target` output → `TargetDescriptor`) + registry, plus a first **AWS Fargate**
  OpenTofu module (`iac/fargate/`, validated with real `tofu validate`); and the
  matching **`aws-fargate` Runner** (dependency-free, shells the `aws` CLI:
  `register-task-definition` → `run-task`, `describe-tasks` → status, CloudWatch
  `logs tail` streaming, `stop-task`); and the **`nemus-cloud` CLI** (own bin,
  dependency-free) — `up`/`down` drive the provisioner, `run` launches the agent
  image on a target (`--follow` logs, `--wait` for the exit code). This
  completes P2. **P3 (in progress):** a bounded **CI-loop** (`runCiLoop`) that
  drives a PR to green over `GitForge` — poll checks, run a fix pass on failure,
  commit/push, repeat; anti-runaway guards (max iterations, no-change → stuck,
  poll-budget → timeout) + a best-effort "needs a human" give-up comment; and
  (P4) a vendor-neutral **notification seam** — `Notifier` with Slack (incoming
  webhook) + generic webhook sinks (`notifierFromEnv`), wired into the CI-loop as
  optional out-of-band report-back.
  **Code-host breadth:** the `GitForge` seam gained a dependency-free **GitLab**
  implementation (`GitLabForge` — merge requests, commit statuses, MR notes;
  self-managed via `GITLAB_API_URL`) alongside GitHub, plus a **forge registry**
  (`createForge`/`registerForge`/`registeredForges` + `NEMUS_FORGE_HOST`) so a
  run targets GitHub or GitLab — or a custom "bring your own backend" host
  (Gitea, Bitbucket, …) — with no code change. Docs in `packages/cloud/README.md`.
  **CI-loop + notifier wired into the agent image:** a second container entry
  mode `NEMUS_MODE=fix-pr` (`runFixPr`/`parseFixPrEnv`, CLI `nemus-cloud fix-pr
  --repo --pr --branch`) drives an *existing* PR to green with the bounded
  CI-loop (P3) + optional Slack/webhook notifications (P4) — clone, checkout PR
  head, `runCiLoop`, then write the same versioned `result.json` with
  `mode: 'fix-pr'` + a compact `ci` summary. So P3+P4 are usable end-to-end in a
  container, on GitHub or GitLab.
  Design: `docs/plans/2026-08-26-cloud-iac.md`.

## [0.2.9] - 2026-08-26

### Fixed

- Synced `package-lock.json` to the current version (it had drifted to 0.2.7
  while package.json was 0.2.8, because the ink/React upgrade regenerated the
  lockfile before the version bump).

### Added

- CI guard `scripts/check-lock-version.js` — fails PR CI (and the release verify
  step) if `package-lock.json`'s `version` / `packages[""]` drift from
  package.json, so a stale lockfile can't reach `npm ci` at release time.

## [0.2.8] - 2026-08-26

### Changed

- Upgraded **ink 5 → 7** and **React 18 → 19** (with `@types/react` 19). The
  dashboard TUI renders through the same CJS/ESM bridge (`sidebar.js` does the
  real `await import('ink')`; components receive `Box`/`Text`/`useInput`/`useApp`
  as props). Verified: build, typecheck, 433 unit tests, and a live pty render of
  the dashboard sidebar. No user-facing change.

## [0.2.7] - 2026-08-25

### Changed

- Removed two **unused** runtime dependencies (`ink-select-input`, `ink-spinner`)
  — they were only referenced in an ambient type-declaration file, never
  imported or rendered. Trims the production dependency tree (322 → 314
  packages), reducing supply-chain surface. No user-facing change.

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

[Unreleased]: https://github.com/me-public/nemus/compare/v0.2.9...HEAD
[0.2.9]: https://github.com/me-public/nemus/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/me-public/nemus/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/me-public/nemus/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/me-public/nemus/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/me-public/nemus/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/me-public/nemus/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/me-public/nemus/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/me-public/nemus/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/me-public/nemus/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/me-public/nemus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/me-public/nemus/releases/tag/v0.1.0
