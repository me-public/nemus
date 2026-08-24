# Releasing Grove

Grove publishes to npm as [`grove-cli`](https://www.npmjs.com/package/grove-cli).
Releases are **automated but gated by a manual approval**, so nothing reaches npm
without a maintainer's explicit sign-off.

## How it works

The [`Release`](../.github/workflows/release.yml) workflow runs when either:

- a commit lands on `main` that changes the `version` field in `package.json`, or
- a maintainer triggers it manually (**Actions → Release → Run workflow**).

It then:

1. **`detect`** — decides whether there's a new version to ship.
2. **`verify`** — runs `npm ci`, build, typecheck, tests, and a packaging dry-run.
3. **`publish`** — runs in the **`release` GitHub Environment**, which is
   configured with **required reviewers**. GitHub pauses the run here and waits
   for a maintainer to click **Approve**. Only after approval does it
   `npm publish --provenance`, tag the commit, and create a GitHub Release.

## One-time setup (maintainers)

1. **Create an npm automation token** with publish rights for `grove-cli` and add
   it as the repository secret **`NPM_TOKEN`**
   (*Settings → Secrets and variables → Actions*).
2. **Create the `release` environment** (*Settings → Environments → New
   environment → `release`*) and add yourself / the maintainer team under
   **Required reviewers**. Optionally restrict it to the `main` branch.
3. Ensure the default `GITHUB_TOKEN` has `contents: write` (already requested by
   the workflow) so it can create tags and releases.

> Provenance (`--provenance`) requires the `id-token: write` permission, which the
> workflow already grants. It gives users a verifiable link between the published
> package and the exact commit + workflow that built it.

## Cutting a release

```bash
# 1. Make sure main is green and up to date
git checkout main && git pull

# 2. Bump the version (choose one)
npm version patch   # bug fixes
npm version minor   # new features
npm version major   # breaking changes

# 3. Update CHANGELOG.md under a new heading for the version

# 4. Push the commit (npm version also creates a git tag locally; push both)
git push && git push --tags
```

Pushing the version bump to `main` starts the workflow. Open the run in the
**Actions** tab, review the `verify` results, then **approve** the `publish` job.

## After release

- Confirm the new version on npm: `npm view grove-cli version`.
- Confirm the GitHub Release and tag were created.
- Announce in Discussions / release notes as appropriate.

## Rolling back

npm does not allow re-publishing the same version. If a release is broken:

1. `npm deprecate grove-cli@<bad-version> "broken release, use <good-version>"`.
2. Fix forward: bump to a new patch version and release again.
