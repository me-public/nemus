import { describe, it, expect, vi, afterEach } from 'vitest';
import { logInfo, logSuccess, logStep, logWarning, logError, setQuiet, isQuiet } from './logger';

afterEach(() => {
  setQuiet(false);
  vi.restoreAllMocks();
});

describe('--quiet (setQuiet)', () => {
  it('suppresses info/success/step but keeps warnings + errors', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setQuiet(true);
    expect(isQuiet()).toBe(true);

    logInfo('i');
    logSuccess('s');
    logStep('st');
    expect(err).not.toHaveBeenCalled(); // routine progress silenced

    logWarning('w');
    logError('e');
    expect(err).toHaveBeenCalledTimes(2); // warnings + errors still shown
    expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/w[\s\S]*e|e[\s\S]*w/);
  });

  it('emits everything when not quiet', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setQuiet(false);
    logInfo('i');
    logSuccess('s');
    logStep('st');
    logWarning('w');
    logError('e');
    expect(err).toHaveBeenCalledTimes(5);
  });
});
