import { describe, it, expect } from 'vitest';
import { buildVersionInfo } from './version';

describe('buildVersionInfo', () => {
  it('combines the given version with the injected runtime fields', () => {
    const info = buildVersionInfo('1.2.3', {
      versions: { node: '22.13.0' } as NodeJS.ProcessVersions,
      platform: 'linux',
      arch: 'x64',
    });
    expect(info).toEqual({ version: '1.2.3', node: '22.13.0', platform: 'linux', arch: 'x64' });
  });

  it('defaults to the real process runtime', () => {
    const info = buildVersionInfo('9.9.9');
    expect(info.version).toBe('9.9.9');
    expect(info.node).toBe(process.versions.node);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });
});
