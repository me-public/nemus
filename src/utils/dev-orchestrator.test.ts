import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setColorEnabled } from './colors';
import {
  detectPackageManager,
  pickDevScript,
  scriptRunCommand,
  resolveDevCommand,
  assignColors,
  formatPrefix,
  createLineSplitter,
  runDev,
  PREFIX_COLORS,
  type DevService,
} from './dev-orchestrator';

beforeEach(() => setColorEnabled(false)); // deterministic, uncolored strings

describe('detectPackageManager', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pm-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('detects pnpm/yarn from lockfiles, defaults to npm', () => {
    expect(detectPackageManager(tmp)).toBe('npm');
    fs.writeFileSync(path.join(tmp, 'yarn.lock'), '');
    expect(detectPackageManager(tmp)).toBe('yarn');
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmp)).toBe('pnpm'); // pnpm wins over yarn
  });
});

describe('pickDevScript', () => {
  it('honors an explicit preferred script when present', () => {
    expect(pickDevScript({ dev: 'x', start: 'y' }, 'start')).toBe('start');
    expect(pickDevScript({ dev: 'x' }, 'start')).toBeNull(); // preferred missing
  });
  it('falls back to dev → develop → start → serve order', () => {
    expect(pickDevScript({ start: 'a', serve: 'b' })).toBe('start');
    expect(pickDevScript({ serve: 'b' })).toBe('serve');
    expect(pickDevScript({ develop: 'd', start: 's' })).toBe('develop');
  });
  it('returns null for no scripts / no match', () => {
    expect(pickDevScript(undefined)).toBeNull();
    expect(pickDevScript({ build: 'x', test: 'y' })).toBeNull();
  });
});

describe('scriptRunCommand', () => {
  it('uses run for npm, bare for yarn/pnpm', () => {
    expect(scriptRunCommand('npm', 'dev')).toBe('npm run dev');
    expect(scriptRunCommand('yarn', 'dev')).toBe('yarn dev');
    expect(scriptRunCommand('pnpm', 'start')).toBe('pnpm start');
  });
});

describe('resolveDevCommand', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-res-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('prefers an explicit command override', () => {
    expect(resolveDevCommand(tmp, { commandOverride: 'make run' })).toEqual({ command: 'make run', source: 'command' });
  });
  it('resolves a package.json script with the detected pm', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
    expect(resolveDevCommand(tmp)).toEqual({ command: 'pnpm dev', source: 'pnpm · dev' });
  });
  it('returns null when there is no package.json or no runnable script', () => {
    expect(resolveDevCommand(tmp)).toBeNull();
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }));
    expect(resolveDevCommand(tmp)).toBeNull();
  });
  it('returns null for malformed package.json', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{ not json');
    expect(resolveDevCommand(tmp)).toBeNull();
  });
});

describe('assignColors', () => {
  it('assigns and cycles the palette', () => {
    const many = Array.from({ length: PREFIX_COLORS.length + 2 }, (_, i) => `r${i}`);
    const map = assignColors(many);
    expect(map.get('r0')).toBe(PREFIX_COLORS[0]);
    expect(map.get(`r${PREFIX_COLORS.length}`)).toBe(PREFIX_COLORS[0]); // wrapped
  });
});

describe('formatPrefix', () => {
  it('pads the label to the column width (colors disabled)', () => {
    expect(formatPrefix('web', 6, 'cyan')).toBe('web    |');
  });
});

describe('createLineSplitter', () => {
  it('emits complete lines and holds the partial until flushed', () => {
    const s = createLineSplitter();
    expect(s.push('hello\nwor')).toEqual(['hello']);
    expect(s.push('ld\n')).toEqual(['world']);
    expect(s.push('tail')).toEqual([]);
    expect(s.flush()).toBe('tail');
    expect(s.flush()).toBeNull();
  });
});

// ── runDev integration (fake spawn / signals / kills) ───────────────────────

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = Math.floor(Math.random() * 1e6);
  kill() { return true; }
  emitExit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('exit', code, signal);
  }
}

function harness(labels: string[]) {
  const children = new Map<string, FakeChild>();
  const out = new PassThrough();
  const err = new PassThrough();
  let outBuf = ''; out.on('data', c => (outBuf += c));
  let errBuf = ''; err.on('data', c => (errBuf += c));
  let signalHandler: ((s: NodeJS.Signals) => void) | null = null;
  const kills: Array<{ label: string; signal: string }> = [];

  const services: DevService[] = labels.map(label => ({
    label, cwd: `/tmp/${label}`, command: { command: `run ${label}`, source: 'command' },
  }));
  const labelByChild = new Map<FakeChild, string>();

  const opts = {
    stdout: out, stderr: err,
    spawnFn: ((_cmd: string) => {
      // services spawn in order, so map by creation order
      const label = labels[children.size];
      const c = new FakeChild();
      children.set(label, c);
      labelByChild.set(c, label);
      return c as unknown as ChildProcess;
    }) as any,
    onSignal: (h: (s: NodeJS.Signals) => void) => { signalHandler = h; return () => { signalHandler = null; }; },
    killFn: (child: ChildProcess, signal: NodeJS.Signals) => {
      kills.push({ label: labelByChild.get(child as unknown as FakeChild)!, signal });
    },
  };
  return { services, opts, children, kills, getOut: () => outBuf, getErr: () => errBuf, signal: (s: NodeJS.Signals) => signalHandler?.(s) };
}

describe('runDev', () => {
  it('prefixes output and resolves 0 when all services exit cleanly', async () => {
    const h = harness(['web', 'api']);
    const p = runDev(h.services, h.opts);
    h.children.get('web')!.stdout.write('ready on :3000\n');
    h.children.get('api')!.stdout.write('listening\n');
    h.children.get('web')!.emitExit(0);
    h.children.get('api')!.emitExit(0);
    expect(await p).toBe(0);
    expect(h.getOut()).toContain('web | ready on :3000');
    expect(h.getOut()).toContain('api | listening');
  });

  it('returns the first non-zero exit code', async () => {
    const h = harness(['web']);
    const p = runDev(h.services, h.opts);
    h.children.get('web')!.emitExit(2);
    expect(await p).toBe(2);
  });

  it('flushes a newline-less trailing line on exit', async () => {
    const h = harness(['web']);
    const p = runDev(h.services, h.opts);
    h.children.get('web')!.stdout.write('no newline here');
    h.children.get('web')!.emitExit(0);
    await p;
    expect(h.getOut()).toContain('web | no newline here');
  });

  it('on signal: SIGTERMs every group, then SIGKILL-sweeps before finishing', async () => {
    const h = harness(['web', 'api']);
    const p = runDev(h.services, { ...h.opts, killTimeoutMs: 10 });
    h.signal('SIGINT');
    // both get SIGTERM immediately
    expect(h.kills.filter(k => k.signal === 'SIGTERM').map(k => k.label).sort()).toEqual(['api', 'web']);
    // children exit in response
    h.children.get('web')!.emitExit(0, 'SIGTERM');
    h.children.get('api')!.emitExit(0, 'SIGTERM');
    await p;
    // a SIGKILL sweep runs before finishing (reaps orphaned group members)
    expect(h.kills.some(k => k.signal === 'SIGKILL')).toBe(true);
  });

  it('exitOnFailure tears everything down when a service fails', async () => {
    const h = harness(['web', 'api']);
    const p = runDev(h.services, { ...h.opts, exitOnFailure: true, killTimeoutMs: 10 });
    h.children.get('web')!.emitExit(1); // failure triggers shutdown
    expect(h.kills.some(k => k.label === 'api' && k.signal === 'SIGTERM')).toBe(true);
    h.children.get('api')!.emitExit(0, 'SIGTERM');
    expect(await p).toBe(1);
  });
});
