#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the `kubernetes` runner against a REAL cluster.
 *
 * Unlike the unit tests (which mock kubectl), this drives the actual
 * KubernetesJobRunner through kubectl against whatever cluster your kubeconfig
 * points at — proving launch → status → exec → logs → stop really work.
 *
 * It is deliberately NOT part of `npm test`/CI: it needs a cluster and pulls a
 * public image. Run it by hand against a throwaway cluster:
 *
 *   kind create cluster --name nemus-e2e
 *   npm run -w @nemus-cli/cloud build
 *   NEMUS_E2E_CONTEXT=kind-nemus-e2e node packages/cloud/e2e/kind-k8s-smoke.mjs
 *   kind delete cluster --name nemus-e2e
 *
 * Env: NEMUS_E2E_CONTEXT (kube context, required — refuse to run without an
 * explicit one so we never touch a real cluster by accident),
 * NEMUS_E2E_NAMESPACE (default "default"), NEMUS_E2E_IMAGE (default busybox).
 */
import { createRunner } from '../dist/index.js';

const context = process.env.NEMUS_E2E_CONTEXT;
const namespace = process.env.NEMUS_E2E_NAMESPACE || 'default';
const image = process.env.NEMUS_E2E_IMAGE || 'busybox:1.36';

if (!context) {
  console.error('refusing to run without NEMUS_E2E_CONTEXT (an explicit kube context, e.g. kind-nemus-e2e)');
  process.exit(2);
}

const MARKER = `hello-from-nemus-${Date.now()}`;
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runner = createRunner('kubernetes');
const target = { version: 1, runner: 'kubernetes', extra: { namespace, context } };
const spec = {
  image,
  // print a marker, then stay alive briefly so we can exec into the live pod.
  command: ['sh', '-c', `echo ${MARKER}; sleep 25`],
  env: { NEMUS_E2E: '1' },
  labels: { 'nemus.e2e': '1' },
};

let handle;
try {
  console.log(`\n== launching ${image} Job in ${context}/${namespace} ==`);
  handle = await runner.launch(spec, target);
  ok('launch returns a handle', !!handle?.id, `job=${handle?.id}`);

  // Wait for the pod to be running (image pull can take a bit on a cold node).
  let state = 'pending';
  for (let i = 0; i < 60 && state !== 'running' && state !== 'succeeded'; i++) {
    await sleep(2000);
    state = (await runner.status(handle)).state;
  }
  ok('status reaches running/succeeded', state === 'running' || state === 'succeeded', `state=${state}`);

  // exec into the live pod. `status: running` = the Job has an active pod, which
  // can still be ContainerCreating, so retry until the container accepts an exec.
  if (state === 'running') {
    let res = { exitCode: 1, stdout: '', stderr: '' };
    for (let i = 0; i < 15 && res.exitCode !== 0; i++) {
      try { res = await runner.exec(handle, ['sh', '-c', 'echo exec-works']); } catch { /* pod not ready yet */ }
      if (res.exitCode !== 0) await sleep(2000);
    }
    ok('exec runs in the pod', res.exitCode === 0 && res.stdout.includes('exec-works'), `rc=${res.exitCode}`);
  } else {
    console.log('· skipped exec (pod already completed before we could attach)');
  }

  // stream logs to completion; must contain our marker. The runner waits for the
  // pod to be Running (--pod-running-timeout) and then follows to exit.
  let logText = '';
  for await (const { line } of runner.logs(handle)) logText += line + '\n';
  ok('logs stream contains the marker', logText.includes(MARKER), `${logText.trim().length} chars`);

  // terminal status — poll briefly, since Job.status.succeeded can lag pod exit.
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
      const gone = await runner.status(handle).then((s) => s.state).catch(() => 'deleted');
      ok('stop removes the job', gone === 'deleted' || gone === 'stopped' || gone === 'succeeded', `state=${gone}`);
    } catch (e) {
      ok('stop removes the job', false, e?.message || String(e));
    }
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
