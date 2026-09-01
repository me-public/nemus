#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the in-box `docker` runner against a REAL local
 * Docker (or Podman) daemon.
 *
 * The docker runner is the design's portability proof — "if a feature can't work
 * against a local Docker socket, it doesn't belong in core" — so it's worth
 * exercising for real, not just with a mocked CLI. Drives the actual DockerRunner
 * through launch → status → exec → logs → stop.
 *
 * Not part of `npm test`/CI (needs a daemon + pulls a public image). Run it by
 * hand:
 *
 *   npm run -w @nemus-cli/cloud e2e:docker
 *
 * Env: NEMUS_E2E_IMAGE (default busybox:1.36), NEMUS_E2E_DOCKER_BIN (default
 * "docker"; set to "podman" to target Podman).
 */
import { execFileSync } from 'node:child_process';
import { DockerRunner } from '../dist/index.js';

const bin = process.env.NEMUS_E2E_DOCKER_BIN || 'docker';
const image = process.env.NEMUS_E2E_IMAGE || 'busybox:1.36';

// Refuse to run if the daemon isn't reachable, so the failure is clear.
try {
  execFileSync(bin, ['info'], { stdio: 'ignore' });
} catch {
  console.error(`refusing to run: \`${bin} info\` failed — is the Docker daemon running?`);
  process.exit(2);
}

const MARKER = `hello-from-nemus-${Date.now()}`;
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runner = new DockerRunner({ bin });
const target = { version: 1, runner: 'docker' };
const spec = {
  image,
  command: ['sh', '-c', `echo ${MARKER}; sleep 20`],
  env: { NEMUS_E2E: '1' },
  labels: { 'nemus.e2e': '1' },
};

let handle;
try {
  console.log(`\n== launching ${image} via ${bin} ==`);
  handle = await runner.launch(spec, target);
  ok('launch returns a container id', !!handle?.id, `id=${handle?.id?.slice(0, 12)}`);

  let state = 'pending';
  for (let i = 0; i < 30 && state !== 'running' && state !== 'succeeded'; i++) {
    await sleep(1000);
    state = (await runner.status(handle)).state;
  }
  ok('status reaches running/succeeded', state === 'running' || state === 'succeeded', `state=${state}`);

  if (state === 'running') {
    const res = await runner.exec(handle, ['sh', '-c', 'echo exec-works']);
    ok('exec runs in the container', res.exitCode === 0 && res.stdout.includes('exec-works'), `rc=${res.exitCode}`);
  } else {
    console.log('· skipped exec (container already exited)');
  }

  // logs -f follows until the container exits; must contain the marker.
  let logText = '';
  for await (const { line } of runner.logs(handle)) logText += line + '\n';
  ok('logs stream contains the marker', logText.includes(MARKER), `${logText.trim().length} chars`);

  let final = await runner.status(handle);
  for (let i = 0; i < 10 && final.state === 'running'; i++) {
    await sleep(1000);
    final = await runner.status(handle);
  }
  ok('final status is succeeded', final.state === 'succeeded', `state=${final.state} exit=${final.exitCode}`);
  ok('exit code is 0', final.exitCode === 0);
} catch (e) {
  console.error('e2e error:', e?.message || e);
  failures++;
} finally {
  if (handle) {
    try {
      await runner.stop(handle);
      const gone = await runner.status(handle).then((s) => s.state).catch(() => 'unknown');
      ok('stop removes the container', gone === 'unknown' || gone === 'stopped', `state=${gone}`);
    } catch (e) {
      ok('stop removes the container', false, e?.message || String(e));
    }
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
