# Nemus cloud target — Kubernetes (OpenTofu module)

Provisions the **durable** half of a Kubernetes execution target: a namespace,
a run **service account** (token automount off), an optional private-registry
pull secret, and optional least-privilege RBAC. The per-run `batch/v1` Job and
`kubectl apply` are the *Runner's* job — fast and ephemeral — so this module owns
only what is shared across runs and rare to change.

It emits a single `target` output that maps directly to a Nemus
`TargetDescriptor` for the [`kubernetes`](../../src/runner/kubernetes.ts) runner.
Works against **any** cluster your kubeconfig can reach (EKS/GKE/AKS/k3s/kind/
on-prem).

## Use it via Nemus

```ts
import { createProvisioner, createRunner, iacModuleDir } from '@nemus-cli/cloud';

const provisioner = createProvisioner('opentofu', {
  moduleDir: iacModuleDir('kubernetes'), // a real path to this shipped module
  vars: { namespace: 'nemus', kube_context: 'my-cluster' },
});

const target = await provisioner.up();   // tofu init + apply -> TargetDescriptor
const runner = createRunner('kubernetes');
const handle = await runner.launch(
  { image: 'ghcr.io/your-org/agent:latest', env: { NEMUS_TASK: '…', GIT_TOKEN: token } },
  target,                                  // extra.namespace / context / service_account / image_pull_secret
);
for await (const { stream, line } of runner.logs(handle)) process[stream].write(line + '\n');
await provisioner.down(target);           // tofu destroy
```

## Use it directly

```bash
cd packages/cloud/iac/kubernetes
tofu init
tofu apply -var namespace=nemus -var kube_context=my-cluster
tofu output -json target
```

## Inputs

| var | default | notes |
| --- | --- | --- |
| `name` | `nemus-agent` | service account (and RBAC) name |
| `namespace` | `nemus` | namespace the Jobs run in |
| `create_namespace` | `true` | set `false` to reuse an existing namespace |
| `kube_config_path` | `~/.kube/config` | kubeconfig used to provision |
| `kube_context` | `""` | context to target; empty → resolve + **pin** the active context at apply time (needs `kubectl` on this path). Handed to the runner |
| `image_pull_secret_dockerconfigjson` | `""` | a docker `config.json` for a private registry; empty → no pull secret |
| `grant_namespace_pod_access` | `false` | opt-in Role letting the SA read its own pods/logs |
| `labels` | `{}` | extra labels on every object |

## Notes

- **Credentials:** standard kubeconfig auth (`kube_config_path` + `kube_context`,
  or `KUBE_*` env). The provisioning identity needs permission to create the
  namespace, service account, secret, and (if enabled) Role/RoleBinding.
- **This is a template.** Running `tofu` against the copy shipped under
  `node_modules` writes `.terraform/` + state there (fragile / sometimes
  read-only). Copy this directory into your own working dir first.
- **Context pinning.** An empty `kube_context` doesn't pass `""` (ambient
  current-context) through to the descriptor — the module resolves the active
  context at apply time via `kubectl config current-context` and pins THAT, so a
  later run or a `down()` on another machine can't silently retarget a different
  cluster. That resolution needs `kubectl` on the provisioning host; pass an
  explicit `kube_context` to avoid the dependency entirely. If nothing resolves,
  it falls back to `""` (honestly ambient, as before).
- **State** is local by default. For a team — or to `down()` from a *different*
  machine than the one that ran `up()` — add your own
  [backend](https://opentofu.org/docs/language/settings/backends/configuration/)
  block. The descriptor's `extra.tofu_vars` hand-back only re-derives the input
  *vars*; local state isn't portable.
- **No API permissions by default.** The agent authenticates to the git forge
  with a token from its environment (a `ForgeTokenSource`), not the Kubernetes
  API, so the service account gets **no** bound Role and its token isn't even
  mounted. Flip `grant_namespace_pod_access` on only if a workflow genuinely
  needs in-cluster reads. This mirrors the Fargate module, which omits the task
  app role.
- **Don't pass the pull secret as a plain `-var` on the CLI** — it lands in argv
  and the streamed apply log. Use a `-var-file` with restrictive permissions, or
  `TF_VAR_image_pull_secret_dockerconfigjson`, and keep state encrypted.
- Validated with `tofu validate` against `hashicorp/kubernetes ~> 2.30`.
