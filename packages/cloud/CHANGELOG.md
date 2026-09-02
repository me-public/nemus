# Changelog — @nemus-cli/cloud

All notable changes to the optional cloud package are documented here. It
versions independently of the core `@nemus-cli/nemus` CLI.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/) — while
pre-1.0 (`0.x`), minor versions may include breaking changes.

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
