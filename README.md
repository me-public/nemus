<p align="center">
  <img src="assets/logo-wordmark.svg" alt="Grove" width="320" />
</p>

<p align="center">
  <b>Multi-repo workspaces for the AI-agent era.</b><br/>
  Create, sync, and operate across dozens of Git repositories with a single command —
  and wire them up to your favorite coding agent.
</p>

<p align="center">
  <a href="https://github.com/grove-cli/grove/actions/workflows/ci.yml"><img src="https://github.com/grove-cli/grove/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/grove-cli"><img src="https://img.shields.io/npm/v/grove-cli.svg" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node >= 22" />
</p>

---

## Why Grove?

Modern products span many repositories. Grove keeps a **workspace** — a named folder
of related repos — in sync and lets you act across all of them at once: clone, pull,
branch, run commands, check status, and diff. Then it connects that workspace to a
coding agent (Claude Code, pi, OpenCode, Codex, Gemini) with generated context files,
skills, and an MCP server, so "work on the payments stack" becomes a single prompt.

- 🌳 **Workspaces** — group repos, clone them all, jump in.
- 🔁 **Operate in bulk** — status, sync, diff, run, branch across every repo.
- 📦 **Suites & snapshots** — save reusable repo collections and exact states.
- 🤖 **Agent-native** — first-class integration with multiple coding agents.
- 🩺 **Healthy by default** — health checks, dependency analysis, retries.

## A full clone per workspace — on purpose

This is the core design decision, so it's worth being explicit: **every workspace
gets its own independent, full `git clone` of each repo.** Two workspaces that both
contain `api` hold two separate clones — each with its own `.git`, index, stash,
hooks, config, branches, and build artifacts.

A reasonable question is *"why not `git worktree`?"* Worktrees attach multiple
working directories to **one shared repository**, which is great for flipping
between branches of a **single** repo. But Grove is built for **many repos worked
on in parallel — often by AI agents — at the same time**, and there full clones win:

| | **Grove: clone per workspace** | **`git worktree`** |
|---|---|---|
| **Scope** | Spans **many repos** per workspace uniformly | A **single-repo** feature (`git worktree add` lives inside one repo) |
| **Isolation** | Total: separate `.git`, index, stash, config, **hooks**, and build outputs (`node_modules/`, `target/`, `dist/`) | Partial: worktrees **share** the object store, config, and hooks |
| **Same branch, twice** | ✅ Two workspaces can both sit on `main` (e.g. stable vs. experiment) | ❌ Git refuses to check out the same branch in two worktrees |
| **Parallel agents** | Safe: one agent's rebase/branch-switch/`gc`/dirty tree can't touch another's | Risky: aggressive concurrent ops share one object DB + refs |
| **Per-workspace remotes/creds** | ✅ Each clone can point at a different fork/remote | ❌ Remotes are shared |
| **Disposable** | It's just a directory — `rm -rf` is safe | Needs `git worktree remove`; a stale/broken worktree can corrupt the parent's list |
| **Tooling** | Every dir is a normal repo — IDEs, scripts, and git tools "just work" | Some tools mishandle the `.git`-file pointer / shared hooks |

**The honest trade-off:** full clones use more disk and take longer to set up than a
worktree that shares the object store. Grove leans into that on purpose and softens
it — clones run **in parallel**, retry on flaky networks, and the repo list is
cached. For juggling many repos across several workspaces (and several agents), the
bulletproof isolation is worth the extra gigabytes. If you're switching branches
within one repo, plain `git worktree` is still the right tool — Grove solves the
different problem of *many* repos in *many* independent workspaces.

## Quick Start

```bash
# Install globally
npm install -g grove-cli

# One-time setup (choose your GitHub org, agent, clone protocol…)
grove configure

# Create your first workspace (interactive repo picker with fuzzy search)
grove create

# Or let an agent do it — describe what you need in plain English
grove -- create a workspace with all payments-related repos
```

After creation you're dropped into the workspace directory with all repos cloned.

> `grove` and the shorter `gv` are equivalent. Use whichever you like.

## Installation

### From npm (recommended)

```bash
npm install -g grove-cli
```

The postinstall step sets up optional shell integration (auto-cd into new
workspaces + a quick-navigate helper).

### From source

```bash
git clone https://github.com/grove-cli/grove.git
cd grove
npm install
npm run build
npm link   # makes `grove` / `gv` available on your PATH
```

### Prerequisites

- **Node.js 22+**
- Git
- [GitHub CLI](https://cli.github.com/) (`gh`), authenticated via `gh auth login`
- SSH keys configured for GitHub (recommended; HTTPS also supported)

## Connecting AI agents

Grove is agent-agnostic. It detects installed agent CLIs and, for each active
agent, writes the right context file, installs skills, and (where supported)
registers its MCP server and hooks.

| Agent | CLI | Context file | MCP | Notes |
|-------|-----|--------------|-----|-------|
| **Claude Code** | `claude` | `CLAUDE.md` | ✅ | Hooks + status line supported |
| **pi** | `pi` | `AGENTS.md` | — | |
| **OpenCode** | `opencode` | `AGENTS.md` | ✅ | Reads `~/.claude/skills` natively |
| **Codex** (OpenAI) | `codex` | `AGENTS.md` | ✅ | Reads `~/.codex/config.toml` |
| **Gemini** (Google) | `gemini` | `GEMINI.md` | ✅ | |

Choose your agent(s) during `grove configure`, or set them any time:

```bash
grove configure          # interactive
# aiAgent:      claude | pi | opencode | codex | gemini | both | auto
# primaryAgent: claude | pi | opencode | codex | gemini | auto
```

- `auto` detects installed CLIs and picks sensibly.
- `both` means **every** installed agent (context files + skills written for all).

### Model providers

The agent CLIs own model/provider auth, so Grove works with **any provider your
agent supports** — Anthropic, OpenAI, Google, or **Amazon Bedrock** — with no extra
configuration in Grove. For example, Claude Code and pi both run against Bedrock via
their own environment (`CLAUDE_CODE_USE_BEDROCK=1`, or pi's `amazon-bedrock`
provider); Codex and Gemini authenticate to OpenAI and Google respectively. Point
your agent at whichever provider you like — Grove just drives the agent.

## Usage

Every command has a short alias (shown in parentheses).

### Create & manage workspaces

```bash
grove create           # (c) interactive create
grove list             # (l) list workspaces
grove update           # (u) add repos to a workspace
grove delete           # (del) delete a workspace
grove go [name]        # jump to a workspace directory
```

### Operate across all repos

```bash
grove status my-workspace     # (st) git status for every repo
grove sync my-workspace       # (s) git pull every repo (auto-retries on flaky network)
grove diff my-workspace       # (d) combined diff summary  (--full for raw diffs)
grove run my-workspace "npm install"   # (r) run a command in every repo
grove doctor my-workspace     # (doc) health checks + score
```

```
Repo             Branch       Status        Ahead/Behind   Modified
─────────────────────────────────────────────────────────────────────
api              main         ✓ Clean       Up to date     -
web              feature/x    ⚠ 2 modified  ↑1             2 files
shared-lib       main         ✓ Clean       ↓3             -
```

### Suites (reusable repo collections)

```bash
grove suite create            # (sc) save a set of repos (+ optional post-clone hooks)
grove suite list              # (sls)
grove suite use               # (fs) create a workspace from a suite
grove suite export my-suite -o my-suite.json
grove suite import my-suite.json
```

### Branches & snapshots

```bash
grove branch switch           # (sb) switch every repo to a branch
grove branch create ws feature/new-thing   # (bc)
grove snapshot save ws        # (ss) capture exact branches/commits/dirty state
grove snapshot restore <id>   # (sr)
```

### AI assistant

```bash
grove -- create a workspace for the payments team
grove -- list my workspaces and show their status
```

Grove exposes an **MCP server** (`grove-mcp`) so MCP-capable agents can search
repos, create/update workspaces, check status, and more directly from a prompt.

Run `grove --help` for the full command reference.

## Configuration

`grove configure` writes `~/.workspace-manager-cache/config.json`. Environment
variables override it:

```bash
export WORKSPACE_MANAGER_DIR="$HOME/my-workspaces"      # default: ~/workspaces
export WORKSPACE_MANAGER_CACHE_DIR="$HOME/.cache/grove" # default: ~/.workspace-manager-cache
```

Key settings: `githubOrg` (which org's repos to list — leave empty to list your
own), `cloneProtocol` (`ssh`|`https`), `aiAgent`, `primaryAgent`, `installMcp`.

## Workspace layout

```
~/workspaces/
└── my-workspace/
    ├── .workspace-meta.json    # repos, timestamps, health
    ├── AGENTS.md / CLAUDE.md    # generated agent context
    ├── api/                     # cloned repos
    ├── web/
    └── shared-lib/
```

## Development

```bash
npm run build        # compile TypeScript
npm test             # run the test suite (vitest)
npm run typecheck    # tsc --noEmit
npm link             # use your local build globally
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and
[docs/architecture.md](docs/architecture.md) for a tour of the codebase.

## Releasing

Releases are automated and gated by a manual approval. Bump the version, merge to
`main`, and approve the deployment — see [docs/releasing.md](docs/releasing.md).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Grove contributors
