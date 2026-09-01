import { describe, it, expect, vi } from 'vitest';
import { resolveEditor, openInEditor } from './editor';

describe('resolveEditor', () => {
  it('prefers $VISUAL over $EDITOR', () => {
    expect(resolveEditor({ VISUAL: 'code --wait', EDITOR: 'vim' }, 'darwin')).toEqual(['code', '--wait']);
  });
  it('falls back to $EDITOR, splitting flags', () => {
    expect(resolveEditor({ EDITOR: 'emacs -nw' }, 'linux')).toEqual(['emacs', '-nw']);
  });
  it('platform default when neither is set', () => {
    expect(resolveEditor({}, 'win32')).toEqual(['notepad']);
    expect(resolveEditor({}, 'linux')).toEqual(['vi']);
    expect(resolveEditor({ EDITOR: '   ' }, 'darwin')).toEqual(['vi']); // blank ignored
  });
});

describe('openInEditor', () => {
  it('launches editor argv[0] + flags + file, inheriting stdio', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 }) as any;
    const res = openInEditor('/tmp/config.json', { spawn, env: { EDITOR: 'code --wait' }, platform: 'darwin' });
    expect(spawn).toHaveBeenCalledWith('code', ['--wait', '/tmp/config.json'], { stdio: 'inherit' });
    expect(res).toEqual({ ok: true, editor: 'code', code: 0 });
  });

  it('reports a non-zero editor exit as not-ok', () => {
    const spawn = vi.fn().mockReturnValue({ status: 1 }) as any;
    expect(openInEditor('/f', { spawn, env: { EDITOR: 'vi' } }).ok).toBe(false);
  });

  it('reports a missing editor (ENOENT) with a clear message', () => {
    const spawn = vi.fn().mockReturnValue({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) as any;
    const res = openInEditor('/f', { spawn, env: { EDITOR: 'nope' } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });
});
