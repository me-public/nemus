# @nemus-cli/cloud

> **Optional, vendor-neutral cloud/IaC runners for Nemus.** Not required for
> local Nemus — this package lets you run a workspace + coding agent on *your
> own* infrastructure (local Docker, Fly, Fargate, k8s, …), headlessly, and open
> a PR.

**Status: scaffold (Phase 0/1).** The first concrete piece is the forge-auth
seam. Runners, Provisioners, the Target Descriptor and the CI-loop land in later
phases. See [`docs/plans/2026-08-26-cloud-iac.md`](../../docs/plans/2026-08-26-cloud-iac.md)
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

## Develop

```bash
npm run build     -w @nemus-cli/cloud
npm run typecheck -w @nemus-cli/cloud
npm test          -w @nemus-cli/cloud
```
