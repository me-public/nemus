import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockListSuites } = vi.hoisted(() => ({ mockListSuites: vi.fn() }));

vi.mock('../../utils/suite', () => ({ listSuites: mockListSuites }));
vi.mock('../../utils/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));
vi.mock('../../utils/colors', () => ({ colorize: (t: string) => t }));

import { main } from './list';

function makeSuite(name: string, entries = 1) {
  return {
    name,
    description: `${name} desc`,
    entries: Array.from({ length: entries }, (_, i) => ({ directoryName: `repo-${i}`, repoName: `repo-${i}` })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('suite list --json', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits one valid JSON document with normalized suites', async () => {
    mockListSuites.mockResolvedValueOnce([makeSuite('fees', 2), makeSuite('platform', 1)]);
    await main({ json: true });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(payload.count).toBe(2);
    expect(payload.suites[0]).toEqual({
      name: 'fees',
      description: 'fees desc',
      repoCount: 2,
      entries: [
        { directoryName: 'repo-0', repoName: 'repo-0' },
        { directoryName: 'repo-1', repoName: 'repo-1' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('empty list emits count 0 (no header/log noise)', async () => {
    mockListSuites.mockResolvedValueOnce([]);
    await main({ json: true });
    const payload = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(payload).toEqual({ count: 0, suites: [] });
  });

  it('non-json mode does not write to the stdout data channel', async () => {
    mockListSuites.mockResolvedValueOnce([makeSuite('fees')]);
    await main();
    // human output goes through console.log (mocked), not process.stdout.write
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
