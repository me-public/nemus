# @nemus-cli/cloud

> **Optional, vendor-neutral cloud/IaC runners for Nemus.** Not required for
> local Nemus — this package lets you run a workspace + coding agent on *your
> own* infrastructure (local Docker, Fly, Fargate, k8s, …), headlessly, and open
> a PR.

**Status: P1 in progress.** The forge-auth seam and the execution seam (runners,
with the in-box Docker runner) are in; the agent OCI image, Provisioners and the
CI-loop land in later phases. See
[`docs/plans/2026-08-26-cloud-iac.md`](../../docs/plans/2026-08-26-cloud-iac.md)
for the full design.

## Why a separate package

Nemus core is deliberately **local-first, vendor-neutral, zero-cloud** — and CI
enforces it. Cloud support carries heavier, provider-specific dependencies, so
it lives here, opt-in, and never touches the core package. Installing
`@nemus-cli/nemus` pulls in none of this.

## What's here today: the forge-auth seam

The one auth boundary the whole cloud system depends on. Nothing downstream
knows whether a token came from a PAT or a GitHub App:

```ts
import { forgeAuthFromEnv, createForgeTokenSource } from '@nemus-cli/cloud';

// From env (the runner-image convention):
const src = forgeAuthFromEnv(); // NEMUS_FORGE=github-app | pat, GITHUB_APP_* / GITHUB_TOKEN
const { token, expiresAt } = await src.getToken({
  repos: ['acme/api', 'acme/web'],
  permissions: { contents: 'write', pull_requests: 'write', checks: 'read' },
});
```

- **`pat`** — static token; works everywhere; zero config.
- **`github-app`** — mints short-lived, **least-privilege**, **auto-refreshing**
  *installation* tokens (dependency-free RS256 via Node `crypto`); auto-discovers
  the installation by owner. Where the App private key lives (client-side / in
  task / broker) is a **deployment policy**, not baked in — see the plan.

## The execution seam: runners

Core orchestration talks only to a `Runner` (+ `Provisioner`) with a neutral
`TaskSpec`/`TargetDescriptor` — never a cloud SDK. Backends declare
`Capabilities` and features degrade on what's missing. Ship `docker` in-box;
other backends are opt-in `@nemus-cli/cloud-<name>` plugins resolved by name.

```ts
import { createRunner } from '@nemus-cli/cloud';

const runner = createRunner('docker'); // in-box; needs no cloud account
const handle = await runner.launch(
  { image: 'ghcr.io/acme/agent:latest', env: { NEMUS_TASK: '…', GIT_TOKEN: token } },
  { version: 1, runner: 'docker' },
);
for await (const { stream, line } of runner.logs(handle)) process[stream].write(line + '\n');
await runner.status(handle); // { state: 'succeeded' | 'failed' | … }
```

The **`docker` runner is the portability boundary's proof**: if a feature can't
work against a local Docker socket, it doesn't belong in core.

## The provisioning seam: IaC modules

Provisioning (stand up a place to run) is split from execution (run a task).
Rather than invent an IaC DSL, one generic **`OpenTofuProvisioner`** delegates to
real `tofu`/`terraform` over a module directory and maps the module's `target`
output to a `TargetDescriptor`. Provider quirks (VPC, roles, Fly org) stay in the
module's HCL + vars — never in core. One provisioner, many modules.

```ts
import { createProvisioner, iacModuleDir } from '@nemus-cli/cloud';

const p = createProvisioner('opentofu', {
  moduleDir: iacModuleDir('fargate'), // a real path to the shipped module
  vars: { region: 'us-east-1', name: 'nemus' },
});
const target = await p.up();   // tofu init + apply -> TargetDescriptor
// … createRunner(target.runner).launch(spec, target) …
await p.down(target);          // tofu destroy
```

Shipped modules live under [`iac/`](./iac): `iac/fargate/` (AWS ECS Fargate,
validated with real `tofu validate`). Fly and others are just more modules.

The shipped module is a **template** — running `tofu` against `iacModuleDir(...)`
directly writes state under `node_modules`. For anything real, **copy it to your
own working dir** (or point a remote backend at it) so state is durable, and
**don't pass secrets as `-var`** (they land in argv and the streamed apply log —
use the provider's own credential env / a `SecretSource`).

## The code-host seam: `GitForge` (GitHub, GitLab, or your own)

Report-back and the CI-loop talk only to a `GitForge` — `openPR`, `getChecks`,
`comment` — never to a host SDK. Two backends ship in-box (both dependency-free,
`fetch`-only): **`github`** (REST; PRs, check-runs, issue comments; works against
GitHub Enterprise via `GITHUB_API_URL`) and **`gitlab`** (REST v4; merge
requests, commit statuses, MR notes; works against self-managed GitLab via
`GITLAB_API_URL`). Both are authenticated by the same `ForgeTokenSource`, so
PAT / GitHub-App auth is orthogonal to which host you target.

Build one by kind with the registry instead of `new GitHubForge(...)`:

```ts
import { createForge, forgeKindFromEnv, forgeApiBaseFromEnv, forgeAuthFromEnv } from '@nemus-cli/cloud';

const tokenSource = forgeAuthFromEnv(process.env);
const kind = forgeKindFromEnv(process.env);            // NEMUS_FORGE_HOST, default 'github'
const forge = createForge(kind, {
  tokenSource,
  apiBaseUrl: forgeApiBaseFromEnv(kind, process.env),  // GITHUB_API_URL | GITLAB_API_URL
});
await forge.openPR({ owner: 'acme', repo: 'api', head: 'nemus/x', base: 'main', title: '…', draft: true });
```

The container entrypoint (`nemus-cloud-agent`) already does exactly this, so a
run targets GitLab by setting **`NEMUS_FORGE_HOST=gitlab`** (+ a GitLab token) —
no code change. Neutral-vocabulary mapping for GitLab: a PR is a **merge
request** and `PullRequest.number` is its project-scoped **iid**; "checks" are
**commit statuses** for the head SHA; a repo `{ owner, repo }` addresses the
URL-encoded `namespace/path` project (subgroups in `owner` are fine); draft is
the `Draft:` title prefix; a `manual` job maps to `neutral` so an un-triggered
manual gate never reads as a red check.

### Bring your own backend

Gitea, Bitbucket, a corporate host — implement the three-method `GitForge`
interface and register it under a kind name. No fork required:

```ts
import { registerForge, createForge, type GitForge } from '@nemus-cli/cloud';

class GiteaForge implements GitForge {
  readonly id = 'gitea';
  async openPR(input) { /* … your host's API … */ }
  async getChecks(ref) { /* map host statuses -> CheckRun[] */ }
  async comment(input) { /* … */ }
}

registerForge('gitea', (opts) => new GiteaForge(opts)); // opts: { tokenSource, apiBaseUrl?, fetchImpl? }
// now createForge('gitea', …) and NEMUS_FORGE_HOST=gitea resolve it
```

Registering an existing kind name overrides it (last write wins), so you can
swap even the built-in `github`/`gitlab` behavior. `registeredForges()` lists
what's available.

## The CLI: `nemus-cloud`

A thin, dependency-free CLI ties the seams together end-to-end:

```bash
# 1) provision a target (writes .nemus-target.json)
nemus-cloud up --module fargate --var region=us-east-1 --var name=nemus

# 2) run the agent image on it (forge auth from env: GITHUB_TOKEN or GITHUB_APP_*)
nemus-cloud run --image ghcr.io/acme/agent:latest \
  --repos acme/api,acme/web --task "add idempotency keys" --owner acme --follow --wait

# 3) drive an EXISTING PR to green (CI-loop + notifications, no new PR)
nemus-cloud fix-pr --image ghcr.io/acme/agent:latest \
  --repo acme/api --pr 42 --branch nemus/add-idempotency-keys --wait

# 4) tear it down
nemus-cloud down --module fargate
```

`up`/`down` drive the `OpenTofuProvisioner`; `run` builds the agent env contract
+ a tag-safe `TaskSpec` and launches it via the target's `Runner`, optionally
streaming logs (`--follow`) and waiting for the exit code (`--wait`). Run
`nemus-cloud help` for all flags.

### `fix-pr`: make P3 + P4 usable end-to-end

`fix-pr` is the second container entry mode (selected by `NEMUS_MODE=fix-pr`):
instead of opening a **new** PR, it takes an **existing** one and drives it to
green with the bounded **CI-loop** (P3) and optional **notifications** (P4). In
the image it clones the repo, checks out the PR head branch, then hands off to
`runCiLoop` — poll checks, run a fix pass on failure, commit, push, re-check,
bounded so it can't spin; a give-up posts a best-effort "needs a human" comment
and (if configured) a Slack/webhook alert. It writes the same versioned
`result.json` as `run`, with an added `mode: 'fix-pr'` and a compact `ci`
summary (`{ ok, state, iterations }`).

Because it goes through the forge registry and notifier seam, it works against
GitHub or GitLab (`NEMUS_FORGE_HOST=gitlab`) and reports out-of-band via
`SLACK_WEBHOOK_URL` / `NEMUS_WEBHOOK_URL` — all opt-in, all vendor-neutral. Tune
the loop with `--max-iterations` / `--poll-interval-ms` / `--max-polls`.

## Develop

```bash
npm run build     -w @nemus-cli/cloud
npm run typecheck -w @nemus-cli/cloud
npm test          -w @nemus-cli/cloud
```
