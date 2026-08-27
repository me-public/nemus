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

## The CLI: `nemus-cloud`

A thin, dependency-free CLI ties the seams together end-to-end:

```bash
# 1) provision a target (writes .nemus-target.json)
nemus-cloud up --module fargate --var region=us-east-1 --var name=nemus

# 2) run the agent image on it (forge auth from env: GITHUB_TOKEN or GITHUB_APP_*)
nemus-cloud run --image ghcr.io/acme/agent:latest \
  --repos acme/api,acme/web --task "add idempotency keys" --owner acme --follow --wait

# 3) tear it down
nemus-cloud down --module fargate
```

`up`/`down` drive the `OpenTofuProvisioner`; `run` builds the agent env contract
+ a tag-safe `TaskSpec` and launches it via the target's `Runner`, optionally
streaming logs (`--follow`) and waiting for the exit code (`--wait`). Run
`nemus-cloud help` for all flags.

## Develop

```bash
npm run build     -w @nemus-cli/cloud
npm run typecheck -w @nemus-cli/cloud
npm test          -w @nemus-cli/cloud
```
