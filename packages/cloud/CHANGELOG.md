# Changelog — @nemus-cli/cloud

All notable changes to the optional cloud package are documented here. It
versions independently of the core `@nemus-cli/nemus` CLI.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/) — while
pre-1.0 (`0.x`), minor versions may include breaking changes.

## [0.1.1] - 2026-09-03

### Changed

- **`nemus-cloud run`/`fix-pr` now surface *why* a task failed.** On a failed
  `--wait` (without `--follow`), the CLI prints the tail of the task logs — the
  agent's `[nemus-cloud-agent] result: …` summary, per-repo clone errors, or a
  missing-model-creds message — instead of a bare `task failed (exit 1)`. The
  tail read is deadline-bounded and releases the log stream when done, so it
  can't hang on a runner whose stream never terminates (the fargate runner's
  `aws logs tail --follow` polls CloudWatch forever).

### Fixed

- **Log streamers now kill their child process when the consumer stops early.**
  Previously breaking out of a `logs()` stream left the `docker logs -f` /
  `aws logs tail --follow` child running with an open pipe, which could keep the
  CLI's event loop alive (hanging the process) and leak the child.

### Verified

- End-to-end live smokes re-run green on this release: `docker` runner
  (launch→status→exec→logs→stop), `kubernetes` runner on a real kind cluster,
  the agent image contract (env → `result.json` → exit code, secret redaction),
  a real clone against live GitHub, and both shipped IaC modules validate under
  OpenTofu.

## [0.1.0] - 2026-09-01

First published release — **experimental**. Previously in-repo only.

### Added

- **Execution seam**: `Runner`/`Provisioner` interfaces over a neutral
  `TaskSpec`/`TargetDescriptor`/`Capabilities`, with a name-resolved registry.
- **Runners**: `docker` (in-box, no cloud account), `aws-fargate`, and
  `kubernetes` (renders a one-shot `batch/v1` Job). docker + kubernetes have
  live smoke tests; fargate is unit-tested (not yet validated against a live AWS
  account).
- **Provisioners**: a generic `OpenTofuProvisioner` (`opentofu`/`terraform`)
  with shipped `iac/fargate` and `iac/kubernetes` modules (`tofu validate`-clean).
- **Forges**: token-based, dependency-free `GitHub` and `GitLab` (`openPR` /
  `getChecks` / `comment`), with `NEMUS_FORGE_HOST` for self-managed hosts.
- **Forge auth**: `ForgeTokenSource` with `pat` and least-privilege,
  auto-refreshing `github-app` installation tokens (dependency-free RS256).
- **Agent image**: an OCI image + `nemus-cloud-agent` entrypoint with `run`
  (clone → agent → PR) and `fix-pr` (drive an existing PR to green) modes,
  writing a versioned `result.json`.
- **CI-fix loop**: a bounded, vendor-neutral loop over the `GitForge` seam with
  anti-runaway guards, plus optional Slack/webhook notifiers.
- **CLI**: `nemus-cloud` (`up`/`down`/`run`/`fix-pr`) and a `runners` discovery
  command (`--json`).
- Zero runtime dependencies; standalone (no dependency on the core CLI).
