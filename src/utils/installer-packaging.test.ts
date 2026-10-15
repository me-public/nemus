import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Guards the published package against shipping an installer script that
// depends on a file npm doesn't publish.
//
// The failure mode this prevents: an installer starts loading a new helper from
// its own directory, the helper isn't added to package.json "files", and only
// the PUBLISHED tarball lacks it (the repo checkout has it, so local runs and
// CI pass). Under `set -e` the installer then dies before writing the shell
// wrappers, and since postinstall never fails `npm install`, a fresh install
// silently ends up with a CLI that can't cd into workspaces or launch an agent.
const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = ['install-shell-integration.sh', 'uninstall.sh', 'install.sh'];

/** Every file a script references relative to its own directory ($SCRIPT_DIR/<file>). */
function scriptDependencies(script: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, script), 'utf-8');
  const deps = new Set<string>();
  const re = /\$(?:\{SCRIPT_DIR\}|SCRIPT_DIR)\/([A-Za-z0-9._\/-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) deps.add(m[1]);
  return [...deps];
}

/** The exact file list `npm pack` would publish. */
function packedFiles(): Set<string> {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [info] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  return new Set(info.files.map(f => f.path));
}

describe('installer packaging', () => {
  it('finds the installer dependencies (sanity: the parser still matches)', () => {
    expect(scriptDependencies('install-shell-integration.sh')).toContain('remove-shell-block.awk');
    expect(scriptDependencies('uninstall.sh')).toContain('remove-shell-block.awk');
  });

  it('publishes every installer script and every file it loads from $SCRIPT_DIR', () => {
    const packed = packedFiles();
    // dist/ only exists after `npm run build` (CI builds first); on an unbuilt
    // checkout skip those entries rather than fail on a missing build.
    const built = fs.existsSync(path.join(ROOT, 'dist'));
    const required = new Set<string>();
    for (const script of SCRIPTS) {
      required.add(script);
      for (const dep of scriptDependencies(script)) {
        if (dep.startsWith('dist/') && !built) continue;
        required.add(dep);
      }
    }
    const missing = [...required].filter(f => !packed.has(f));
    expect(missing, `not in the npm tarball (add to package.json "files"): ${missing.join(', ')}`).toEqual([]);
  }, 60_000);
});
