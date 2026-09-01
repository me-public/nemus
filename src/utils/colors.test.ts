import { describe, it, expect, afterEach } from 'vitest';
import { colors, colorize, setColorEnabled, isColorEnabled, detectColorEnabled } from './colors';

// Tests toggle global color state; restore a known state afterward.
afterEach(() => setColorEnabled(true));

describe('setColorEnabled / colorize', () => {
  it('wraps with ANSI when on, and is plain when off (same call sites)', () => {
    setColorEnabled(true);
    expect(isColorEnabled()).toBe(true);
    const on = colorize('hi', 'green');
    expect(on).toContain('\x1b[32m');
    expect(on).toContain('\x1b[0m');
    expect(on).toContain('hi');

    setColorEnabled(false);
    expect(isColorEnabled()).toBe(false);
    expect(colorize('hi', 'green')).toBe('hi'); // no codes at all
  });

  it('empties inline colors.* codes in place when disabled', () => {
    setColorEnabled(false);
    expect(colors.gray).toBe('');
    expect(colors.reset).toBe('');
    setColorEnabled(true);
    expect(colors.gray).toBe('\x1b[90m');
  });
});

describe('detectColorEnabled', () => {
  it('NO_COLOR disables regardless of value (even empty)', () => {
    expect(detectColorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(detectColorEnabled({ NO_COLOR: '' }, true)).toBe(false);
  });

  it('FORCE_COLOR forces on even without a TTY (but 0/false do not)', () => {
    expect(detectColorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
    expect(detectColorEnabled({ FORCE_COLOR: '0' }, false)).toBe(false);
    expect(detectColorEnabled({ FORCE_COLOR: 'false' }, false)).toBe(false);
  });

  it('NO_COLOR beats FORCE_COLOR', () => {
    expect(detectColorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
  });

  it('otherwise follows the TTY, and TERM=dumb disables', () => {
    expect(detectColorEnabled({}, true)).toBe(true);
    expect(detectColorEnabled({}, false)).toBe(false);
    expect(detectColorEnabled({ TERM: 'dumb' }, true)).toBe(false);
  });
});
