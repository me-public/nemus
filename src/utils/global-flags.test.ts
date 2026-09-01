import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { applyGlobalFlags } from './global-flags';

const spies = () => ({ setColorEnabled: vi.fn(), setQuiet: vi.fn() });

// Mirror the real root-program global options so we test what commander actually
// parses (esp. bundled short flags), not a hand-built opts object.
const rootOpts = (argv: string[]) => {
  const p = new Command();
  p.option('-y, --yes', '').option('-q, --quiet', '').option('--no-color', '');
  p.command('list').action(() => {});
  p.parse(['node', 'nemus', 'list', ...argv]);
  return p.opts();
};

describe('applyGlobalFlags', () => {
  it('does nothing by default (color on, not quiet)', () => {
    const d = spies();
    applyGlobalFlags(rootOpts([]), d);
    expect(d.setColorEnabled).not.toHaveBeenCalled();
    expect(d.setQuiet).not.toHaveBeenCalled();
  });

  it('--no-color disables color', () => {
    const d = spies();
    applyGlobalFlags(rootOpts(['--no-color']), d);
    expect(d.setColorEnabled).toHaveBeenCalledWith(false);
  });

  it('--quiet enables quiet', () => {
    const d = spies();
    applyGlobalFlags(rootOpts(['--quiet']), d);
    expect(d.setQuiet).toHaveBeenCalledWith(true);
  });

  it('bundled short flags (-yq) still enable quiet', () => {
    const d = spies();
    const opts = rootOpts(['-yq']);
    expect(opts.quiet).toBe(true); // commander expands the bundle
    applyGlobalFlags(opts, d);
    expect(d.setQuiet).toHaveBeenCalledWith(true);
  });
});
