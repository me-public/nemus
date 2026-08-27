# Nemus cloud target — AWS Fargate (OpenTofu module)

Provisions the **durable** half of a Fargate execution target: an ECS cluster
(Fargate capacity provider), a CloudWatch log group, an egress-only task
security group, and a task **execution** role. The per-run task definition and
`RunTask` are the *Runner's* job — fast and ephemeral — so this module owns only
what is slow, stateful, and rare.

It emits a single `target` output that maps directly to a Nemus
`TargetDescriptor` for the `aws-fargate` runner.

## Use it via Nemus

```ts
import { createProvisioner, iacModuleDir } from '@nemus-cli/cloud';

const provisioner = createProvisioner('opentofu', {
  moduleDir: iacModuleDir('fargate'), // a real path to this shipped module
  vars: { region: 'us-east-1', name: 'nemus' },
});

const target = await provisioner.up();      // tofu init + apply -> TargetDescriptor
// const runner = createRunner('aws-fargate'); // (P2 follow-up) launches tasks on `target`
// … run tasks …
await provisioner.down(target);             // tofu destroy
```

## Use it directly

```bash
cd packages/cloud/iac/fargate
tofu init
tofu apply -var region=us-east-1 -var name=nemus
tofu output -json target
```

## Inputs

| var | default | notes |
| --- | --- | --- |
| `region` | `us-east-1` | AWS region |
| `name` | `nemus` | prefix for cluster/log-group/role |
| `vpc_id` | `""` | empty → the account's **default VPC** |
| `subnet_ids` | `[]` | empty → all subnets in the selected VPC |
| `log_retention_days` | `14` | CloudWatch Logs retention |
| `tags` | `{}` | extra tags on every resource |

## Notes

- **Credentials:** standard AWS provider auth (`AWS_PROFILE` / env / SSO). The
  module needs permissions to create ECS, IAM, CloudWatch Logs, and EC2 SG
  resources.
- **This is a template.** Running `tofu` against the copy shipped under
  `node_modules` writes `.terraform/` + state there (fragile / sometimes
  read-only). Copy this directory into your own working dir first.
- **State** is local by default. For a team — or to `down()` from a *different*
  machine than the one that ran `up()` — add your own
  [backend](https://opentofu.org/docs/language/settings/backends/configuration/)
  block. The descriptor's `extra.tofu_vars` hand-back only re-derives the input
  *vars*; tofu still needs the **state**, and local state isn't portable, so a
  truly stateless teardown requires a shared/remote backend.
- **Subnets:** by default the module surfaces *all* subnets in the VPC. Fargate
  tasks need to reach the image registry + git forge, so the Runner must place
  them on public subnets with a public IP, or on private subnets behind a NAT.
  Pass `subnet_ids` to pin the right ones.
- **Don't pass secrets as `-var`** — they land in argv and the streamed apply
  log. Use the AWS provider's own credential env.
- **No task role.** The agent authenticates to the git forge with a token from
  its environment (a `ForgeTokenSource`), not cloud IAM, so tasks are granted no
  AWS permissions. The *execution* role only pulls the image and writes logs.
- Validated with `tofu validate` against `hashicorp/aws ~> 5.60`.
