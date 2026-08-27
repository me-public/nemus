import * as path from 'node:path';

/**
 * Absolute path to a shipped IaC module directory (e.g. `iacModuleDir('fargate')`),
 * for use as {@link OpenTofuProvisioner}'s `moduleDir`.
 *
 * The shipped module is a **template**. Running `tofu` directly against this
 * path writes `.terraform/` + local state *inside the installed package* (under
 * `node_modules`), which is fragile (wiped on reinstall, sometimes read-only).
 * For anything real, copy the returned directory into your own working dir — or
 * point a remote backend at it — so state lives somewhere durable.
 *
 * Works both from source (tests) and from `dist/` at runtime: `src/provision`
 * and `dist/provision` are both direct children of the package root, next to
 * `iac/`.
 */
export function iacModuleDir(name: string): string {
  return path.join(__dirname, '..', '..', 'iac', name);
}
