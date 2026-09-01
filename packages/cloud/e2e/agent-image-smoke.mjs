#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the AGENT IMAGE (`nemus-cloud-agent`) — the
 * container the runners launch. Unlike the runner e2es (which run a trivial
 * public image), this runs the REAL agent image through the REAL DockerRunner
 * and asserts the image contract: the entrypoint reads the env, runs the
 * pipeline, writes a valid result.json, and exits non-zero on failure so the
 * runner's status reflects it.
 *
 * The happy path (clone → agent → open PR) needs a live forge + model creds +
 * opens real PRs, so it stays UNIT-tested (see agent.test.ts / run.ts). This
 * exercises the parts that need a real container and can't be faked: image
 * build, bin wiring, env contract, result.json write, and exit-code → status —
 * on deterministic, no-network, no-secret, no-side-effect paths.
 *
 * Not in CI (needs Docker + the built image). Build + run:
 *   npm run -w @nemus-cli/cloud e2e:image
 *
 * Env: NEMUS_E2E_IMAGE (default nemus-cloud-agent:e2e).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { DockerRunner } from '../dist/index.js';

const bin = 'docker';
const image = process.env.NEMUS_E2E_IMAGE || 'nemus-cloud-agent:e2e';

try {
  execFileSync(bin, ['image', 'inspect', image], { stdio: 'ignore' });
} catch {
  console.error(`refusing to run: image "${image}" not found — build it first (npm run -w @nemus-cli/cloud e2e:image), or set NEMUS_E2E_IMAGE`);
  process.exit(2);
}

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runner = new DockerRunner({ bin });
const target = { version: 1, runner: 'docker' };

/** Launch the image with an env, wait for exit, return { status, logs, result }. */
async function runImage(env) {
  const handle = await runner.launch({ image, env, labels: { 'nemus.e2e': 'image' } }, target);
  try {
    let status = await runner.status(handle);
    let waited = 0;
    for (; waited < 30 && status.state !== 'succeeded' && status.state !== 'failed'; waited++) {
      await sleep(1000);
      status = await runner.status(handle);
    }
    if (status.state !== 'succeeded' && status.state !== 'failed') {
      console.log(`  ! timed out after ${waited}s waiting for the container to exit (last state=${status.state}); assertions below may be misleading`);
    }
    let logs = '';
    for await (const { line } of runner.logs(handle)) logs += line + '\n';
    // result.json is written inside the (now-exited) container; copy it out.
    // Safe because DockerRunner.launch uses `docker run -d` (NOT --rm) — the
    // exited container persists until stop() does the `docker rm -f`.
    const tmp = `/tmp/nemus-e2e-result-${handle.id.slice(0, 12)}.json`;
    let result = null;
    try {
      execFileSync(bin, ['cp', `${handle.id}:/workspace/result.json`, tmp], { stdio: 'ignore' });
      result = JSON.parse(readFileSync(tmp, 'utf8'));
      rmSync(tmp, { force: true });
    } catch { /* no result.json */ }
    return { status, logs, result };
  } finally {
    await runner.stop(handle);
  }
}

console.log(`\n== agent image e2e: ${image} ==`);

// Case A — unknown NEMUS_MODE: the entrypoint must fail loudly with a structured
// result.json + non-zero exit (dummy token so it reaches the mode check).
console.log('\nCase A: unknown NEMUS_MODE');
{
  const { status, result } = await runImage({ NEMUS_MODE: 'nope', GITHUB_TOKEN: 'dummy' });
  ok('runner status is failed', status.state === 'failed', `state=${status.state}`);
  ok('exit code is 1', status.exitCode === 1, `exit=${status.exitCode}`);
  ok('result.json is valid + ok:false', !!result && result.ok === false && result.schema === 1);
  ok('result error names the bad mode', !!result?.error && /unknown NEMUS_MODE/i.test(result.error), result?.error);
}

// Case B — real clone path, refused fast (no network egress, no PR). Exercises
// clone → per-repo error isolation → "no repositories were cloned".
console.log('\nCase B: clone refused (report=none, no forge/model, no side effects)');
{
  const env = { GITHUB_TOKEN: 'dummy-secret-xyz', NEMUS_REPOS: 'acme/api', NEMUS_TASK: 'noop', REPORT_MODE: 'none', GIT_HOST: '127.0.0.1:1' };
  const { status, logs, result } = await runImage(env);
  ok('runner status is failed', status.state === 'failed', `state=${status.state}`);
  ok('exit code is 1', status.exitCode === 1, `exit=${status.exitCode}`);
  ok('result.json reports no repos cloned', !!result && result.ok === false && /no repositories were cloned/i.test(result.error || ''));
  ok('the one repo is marked cloned:false with an error', result?.repos?.[0]?.cloned === false && !!result.repos[0].error);
  ok('the git token is NOT leaked in logs', !logs.includes('dummy-secret-xyz'), 'token redacted');
  ok('the git token is NOT leaked in result.json', !JSON.stringify(result || {}).includes('dummy-secret-xyz'));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
