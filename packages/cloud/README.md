# @nemus-cli/cloud

> **Hand a task to a coding agent that runs headlessly on _your own_
> infrastructure — and opens a PR.** Local Docker, AWS Fargate, or any Kubernetes
> cluster today; every boundary is a swappable seam, so you're never locked to a
> vendor. Optional and opt-in: the core Nemus CLI pulls in none of it.

![Nemus Cloud architecture — a neutral core (Provisioner, Runner, ForgeAuth, GitForge, Notifier interfaces) with swappable backends: OpenTofu/Terraform, docker/aws-fargate/kubernetes, PAT/GitHub App, GitHub/GitLab, Slack/webhook](https://raw.githubusercontent.com/me-public/nemus/main/docs/assets/cloud-architecture.png)

## Why you'd want it

- **Your infra, not ours.** No SaaS, no broker, no account with us. It runs on a
  Docker socket, an ECS cluster, or a Kubernetes namespace *you* control. There
  is no cloud SDK in the core Nemus CLI at all.
- **Swappable at every seam.** The orchestration core talks only to five small
  interfaces — **Provisioner, Runner, ForgeAuth, GitForge, Notifier** — never to a
  provider SDK. Pick a backend per boundary, mix and match, or bring your own by
  registering a name (no fork).
- **Two things it does.** `run` — clone repos, run the agent on a task, open a
  draft PR. `fix-pr` — take an *existing* PR and drive it to green with a bounded
  CI-fix loop, reporting out-of-band.
- **Least-privilege auth built in.** The GitHub App path mints short-lived,
  auto-refreshing, scoped installation tokens (dependency-free RS256); nothing
  downstream knows a token's origin.
- **Trustworthy by construction.** Zero runtime dependencies, every seam
  dependency-injected and **unit-tested with no cloud account**, plus live smoke
  tests against real Docker and Kubernetes. The git token is asserted never to
  leak into logs or `result.json`.

```bash
npm install -g @nemus-cli/cloud          # provides nemus-cloud + nemus-cloud-agent

nemus-cloud runners                      # see every backend + its capabilities
nemus-cloud run --image ghcr.io/acme/agent:latest \
  --repos acme/api,acme/web --task "add idempotency keys" --owner acme --follow --wait
```

The rest of this document is the reference for each seam.

---

> [!NOTE]
> **Experimental / pre-1.0 (`0.x`).** The seams are stable and unit-tested, but
> APIs may change before `1.0`, the `aws-fargate` runner hasn't been validated
> against a live AWS account (docker + kubernetes have live smoke tests), and a
> hosted UI is out of scope. Pin an exact version.

**Status: P1–P4 substantially landed.** In: the forge-auth + execution seams with
three runners (`docker`, `aws-fargate`, `kubernetes`), OpenTofu provisioners with
shipped `iac/fargate` + `iac/kubernetes` modules, GitHub/GitLab forges, the agent
OCI image with `run`/`fix-pr` entry modes, a bounded CI-fix loop, Slack/webhook
notifiers, and a `nemus-cloud runners` discovery command. Everything is
dependency-injected and unit-tested with no cloud account. See
[the design plan](https://github.com/me-public/nemus/blob/main/docs/plans/2026-08-26-cloud-iac.md)
for the full design.

## Install

```bash
npm install -g @nemus-cli/cloud   # provides `nemus-cloud` + `nemus-cloud-agent`
```

Standalone (no dependency on the core `@nemus-cli/nemus` CLI) and
zero-runtime-dependency. Requires Node ≥ 22, plus whatever a given backend shells
out to (`docker`, `kubectl`, `aws`, `tofu`/`terraform`, `git`, `gh`).

## Quickstart (5 minutes)

Prove the whole thing on your own machine with the **in-box `docker` runner** —
no cloud account, no provisioning. You'll go from a task to a **real PR**:
clone → agent edits → commit → push → open PR.

**Prerequisites:** a running Docker daemon, `gh auth login` (for a token), and
model credentials (see [Bring your own model](#bring-your-own-model) — the
example below uses an Anthropic key).

```bash
# 1) Build the agent image (no prebuilt image is published yet — it builds from
#    the repo so you can audit exactly what runs).
git clone https://github.com/me-public/nemus.git && cd nemus
npm ci && npm run build -w @nemus-cli/cloud
docker build -f packages/cloud/image/Dockerfile -t nemus-cloud-agent .

# 2) Point at the in-box docker runner (no IaC needed for local Docker).
echo '{"version":1,"runner":"docker"}' > .nemus-target.json

# 3) Hand it a task against a repo you can open a PR on. Forge auth comes from
#    the environment; the model creds ride in via --env (bare KEY forwards the
#    value from your shell, so it stays out of argv / history).
export GITHUB_TOKEN=$(gh auth token)
export ANTHROPIC_API_KEY=sk-ant-...

npx nemus-cloud run \
  --image nemus-cloud-agent \
  --repos <you>/<repo> --owner <you> \
  --task "Add a short 'Running tests' note to CONTRIBUTING.md" \
  --report pr --follow --wait \
  --env ANTHROPIC_API_KEY
```

You'll see the agent clone, edit, push, and print the PR URL:

```
[nemus-cloud-agent] result: ok
  <you>/<repo>: PR https://github.com/<you>/<repo>/pull/1
task succeeded (exit 0)
```

That's the full happy path on real infrastructure you control. To go bigger,
swap the runner (`aws-fargate`, `kubernetes`) via an [IaC module](#the-provisioning-seam-iac-modules)
and keep the exact same `run` command.

## Bring your own model

The agent image runs a coding-agent CLI (`pi` by default, `claude` via
`--env NEMUS_AGENT=claude`) and hands it your task. **Model auth is the agent's
job** — you supply it through `--env`, which forwards credentials/config into the
container. Runners that inject credentials ambiently (e.g. a Fargate **task
role**) don't need `--env` for them at all.

`--env KEY=VAL` sets a literal; a bare `--env KEY` forwards `KEY`'s value from
your shell (keeps secrets out of argv / shell history). Pick a provider:

```bash
# Anthropic (pi's default provider — just supply the key)
--env ANTHROPIC_API_KEY

# OpenAI
--env OPENAI_API_KEY \
--env 'NEMUS_AGENT_ARGS=-p {task} --provider openai --model gpt-4.1'

# Amazon Bedrock (creds from your shell; select an inference-profile model)
--env AWS_ACCESS_KEY_ID --env AWS_SECRET_ACCESS_KEY --env AWS_SESSION_TOKEN \
--env AWS_REGION=us-east-1 \
--env 'NEMUS_AGENT_ARGS=-p {task} --provider amazon-bedrock --model us.anthropic.claude-haiku-4-5-20251001-v1:0'
```

`NEMUS_AGENT_ARGS` is the escape hatch to the underlying agent: a space-split
argument list where `{task}` is replaced with your task. Use it to pin the
provider/model; omit it to take the agent's defaults (with `pi`, an
`ANTHROPIC_API_KEY` in the environment is all you need). For `claude`, either an
`ANTHROPIC_API_KEY` or `--env CLAUDE_CODE_USE_BEDROCK=1` (plus AWS creds) works.

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

### Built-in runners

| Runner (`TargetDescriptor.runner`) | Backend | Needs | `exec` | `logStream` |
| --- | --- | --- | --- | --- |
| `docker` | local Docker/Podman | a Docker socket | ✅ | ✅ |
| `aws-fargate` | AWS ECS Fargate | `aws` CLI + the `iac/fargate` target | ✖ | ✅ (CloudWatch) |
| `kubernetes` | a Kubernetes **Job**, any cluster (EKS/GKE/AKS/k3s/kind/on-prem) | `kubectl` + a reachable context (optionally the `iac/kubernetes` target) | ✅ (`kubectl exec`) | ✅ (`kubectl logs -f`) |

The **`kubernetes`** runner is the clearest proof the seam isn't Fargate-shaped:
it shells `kubectl`, renders a `batch/v1` Job (`backoffLimit: 0`, one-shot,
`ttlSecondsAfterFinished` GC), and needs no IaC — hand-write a descriptor to
target any cluster you already have:

```ts
const runner = createRunner('kubernetes');
const handle = await runner.launch(spec, {
  version: 1,
  runner: 'kubernetes',
  extra: { namespace: 'agents', context: 'my-cluster', service_account: 'nemus-agent', image_pull_secret: 'ghcr-pull' },
});
```

All of a runner's I/O (`kubectl`/`aws`/`docker` invocation, log streaming, and —
for k8s — the manifest write) is injectable, so every backend is unit-tested
without a cloud account or a cluster.

> **k8s logs failure-contract.** `logs()` waits for the pod to reach Running
> (`kubectl --pod-running-timeout`, default 5m) before streaming, then follows to
> exit. The trade-off: a pod that *never* schedules (ImagePullBackOff,
> unschedulable) blocks the stream for that whole timeout before erroring — a
> finite, tunable bound. Headless orchestration that awaits `logs()` before
> polling `status()` should set `target.extra.logs_pod_running_timeout` lower.
> (`status()` can't shorten it: a Job keeps a stuck pod `active`, so it reads
> `running` until `backoffLimit` too.)

### Live end-to-end (real backends)

The unit tests mock the CLIs; separate smoke tests drive the **real** runners
against an actual daemon/cluster (launch → status → exec → logs → stop). They need
a real backend + pull a public image, so they're **not** part of `npm test`/CI —
run them by hand:

```bash
# in-box docker runner (needs a running Docker/Podman daemon)
npm run -w @nemus-cli/cloud e2e:docker

# the agent IMAGE itself (builds nemus-cloud-agent, runs it via the docker runner)
npm run -w @nemus-cli/cloud e2e:image

# kubernetes runner against a throwaway kind cluster
kind create cluster --name nemus-e2e
NEMUS_E2E_CONTEXT=kind-nemus-e2e npm run -w @nemus-cli/cloud e2e:kind
kind delete cluster --name nemus-e2e
```

`e2e:image` runs the **real agent image** (`nemus-cloud-agent`) through the real
`DockerRunner` and asserts the image contract — entrypoint wiring, the env
contract, a valid `result.json`, exit-code → runner `status`, and that the git
token is never leaked into logs/`result.json`. The full happy path (clone → agent
→ open PR) opens real PRs and needs a live forge + model credentials, so it isn't
part of the scripted smoke tests — but it **is proven**: it's exactly the
[Quickstart](#quickstart-5-minutes) (supply model creds via `--env`), and the
deterministic, no-secret slices are unit-tested (`run.ts` / `agent.test.ts`).

The kind test refuses to run without an explicit `NEMUS_E2E_CONTEXT` (so it can't
touch a real cluster by accident); the docker test refuses if the daemon isn't
reachable. The kind test is what caught the `logs --follow` bug the unit tests
couldn't: `--ignore-errors` made `--follow` give up in ~40ms when the container
was still `ContainerCreating`; the runner now uses `--pod-running-timeout` to wait
for the pod, then follow to completion.

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

Shipped modules live under [`iac/`](./iac), each validated with real `tofu
validate`: `iac/fargate/` (AWS ECS Fargate) and `iac/kubernetes/` (a namespace +
run service account + optional pull secret/RBAC, emitting a `kubernetes`-runner
target for any cluster). Fly and others are just more modules.

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
# 0) see what's registered — runners + their capabilities, provisioners,
#    shipped IaC modules, and git forges (add --json for machine output)
nemus-cloud runners

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

`runners` (alias `ls`) is the discovery front door: it instantiates every
registered runner to read its declared `Capabilities`, lists the provisioners and
git forges, and maps each shipped IaC module to the runner it targets — so you
can see what a backend supports before choosing one, and `--json` feeds it to
scripts. `up`/`down` drive the `OpenTofuProvisioner`; `run` builds the agent env contract
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
