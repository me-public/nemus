/**
 * SecretSource — one credential-resolution chain, not per-provider bespoke auth.
 *
 * Backends without a native secret store (e.g. the Docker runner) expect the
 * orchestrator to resolve `TaskSpec.secrets` into plain env first; that's what
 * `resolveSecretsToEnv` below is for. Backends WITH a secret store can instead
 * pass the refs through natively.
 *
 * A ref's `from` is a scheme-prefixed locator, e.g. `env:GITHUB_TOKEN`,
 * `dotenv:GIT_TOKEN`, `gh:github.com`. The scheme picks the source.
 */

export interface SecretSource {
  /** Scheme this source answers to, e.g. 'env' | 'dotenv' | 'gh'. */
  readonly id: string;
  /** Resolve the locator (the part after `scheme:`) to a secret value. */
  resolve(locator: string): Promise<string>;
}
