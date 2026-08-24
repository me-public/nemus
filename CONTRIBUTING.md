# Contributing to Nemus

Thanks for your interest in improving Nemus! This guide covers everything you need
to get set up, make a change, and get it merged.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

**Requirements:** Node.js 22+ and npm 9+.

```bash
# Fork & clone
git clone https://github.com/<your-username>/nemus.git
cd nemus

# Install dependencies
npm install

# Build
npm run build

# Run the CLI from your local build
npm link          # exposes `nemus` / `nem` on your PATH
nemus --help
```

## Project layout

```
src/
├── program.ts          # Commander entry point — registers all commands
├── commands/           # one module per command (create, sync, status, …)
│   ├── suite/          # grouped subcommands (suite, branch, cache)
│   └── dashboard/      # multi-agent TUI (Ink/React)
├── cli/                # interactive TUI + AI-prompt entry points
├── mcp/                # Model Context Protocol server + tools
├── utils/              # shared helpers (git, github, config, agents, …)
└── types/              # shared TypeScript types
bin/workspace.js        # thin launcher for the `nemus`/`nem` binaries
skills/                 # agent skill definitions (Markdown)
assets/                 # brand imagery
```

See [docs/architecture.md](docs/architecture.md) for a deeper tour.

## Making a change

1. **Create a branch:** `git checkout -b feat/short-description`.
2. **Write code** that matches the existing style of the file you're editing.
   There is no enforced formatter — do not run `prettier`/`eslint --fix` across a
   file and bury your change in reformatting. Keep diffs focused.
3. **Add or update tests.** Tests live next to the code as `*.test.ts` and run
   with [Vitest](https://vitest.dev/).
4. **Verify locally:**
   ```bash
   npm run build       # must compile cleanly
   npm run typecheck   # tsc --noEmit
   npm test            # all tests green
   ```
5. **Bump the version** in `package.json` if you changed shipped code
   (`src/`, `bin/`, `skills/`, install scripts). CI reminds you on the PR.
   Use [semver](https://semver.org/): `patch` for fixes, `minor` for features,
   `major` for breaking changes.
6. **Open a pull request** against `main`. Fill in the PR template and link any
   related issue.

## Guidelines

- **Stay vendor-neutral.** Nemus is a general-purpose, org-agnostic tool. Don't
  hard-code a company name, private URL, internal service, or cloud infrastructure.
- **No cloud/hosting code.** Nemus is a local CLI. Server/agent-hosting features
  are out of scope.
- **Agent support:** new agent integrations go through `src/utils/agent-config.ts`
  (add an entry to the registry + `AGENT_ORDER`). Keep them optional and
  auto-detected.
- **Keep it cross-platform** where practical (macOS + Linux are the primary
  targets).
- **Small, reviewable PRs** are much easier to merge than large ones.

## Commit messages

Conventional-commit-style prefixes are appreciated but not required:
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/nemus-cli/nemus/issues/new/choose).
Include your OS, Node version (`node --version`), Nemus version (`nemus --version`),
and clear reproduction steps.

## Releasing

Maintainers publish releases via an approval-gated GitHub Actions workflow — see
[docs/releasing.md](docs/releasing.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
