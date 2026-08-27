import { describe, it, expect, afterEach } from 'vitest';
import {
  createForge,
  registerForge,
  registeredForges,
  forgeKindFromEnv,
  forgeApiBaseFromEnv,
} from './registry';
import { GitForge } from './types';
import { GitHubForge } from './github';
import { ForgeTokenSource } from '../forge/types';

const tokenSource: ForgeTokenSource = {
  id: 'test',
  getToken: async () => ({ token: 't', expiresAt: new Date('2030-01-01') }),
};

describe('createForge', () => {
  it('builds the built-in forges by kind', () => {
    expect(createForge('github', { tokenSource }).id).toBe('github');
    expect(createForge('gitlab', { tokenSource }).id).toBe('gitlab');
  });

  it('throws on an unknown kind, listing the known ones', () => {
    expect(() => createForge('bitbucket', { tokenSource })).toThrow(/unknown forge host "bitbucket"/);
    expect(() => createForge('bitbucket', { tokenSource })).toThrow(/github, gitlab/);
  });
});

describe('registerForge (bring your own backend)', () => {
  const custom = 'my-gitea';
  afterEach(() => {
    // registeredForges() has no unregister; leaving a test-only kind is harmless,
    // but assert it exists so the extension path is covered.
  });

  it('resolves a custom forge and lists it', () => {
    const fake: GitForge = {
      id: 'gitea',
      openPR: async () => ({ number: 1, url: 'u', state: 'open' }),
      getChecks: async () => [],
      comment: async () => {},
    };
    registerForge(custom, () => fake);
    expect(registeredForges()).toContain(custom);
    expect(createForge(custom, { tokenSource })).toBe(fake);
  });

  it('lets a custom factory override a built-in name (last write wins)', () => {
    const sentinel: GitForge = {
      id: 'sentinel',
      openPR: async () => ({ number: 0, url: '', state: 'open' }),
      getChecks: async () => [],
      comment: async () => {},
    };
    registerForge('github', () => sentinel);
    expect(createForge('github', { tokenSource }).id).toBe('sentinel');
    // restore the built-in so registry state doesn't leak to later tests
    registerForge('github', (o) => new GitHubForge(o));
    expect(createForge('github', { tokenSource }).id).toBe('github');
  });
});

describe('forgeKindFromEnv / forgeApiBaseFromEnv', () => {
  it('defaults to github and reads NEMUS_FORGE_HOST', () => {
    expect(forgeKindFromEnv({})).toBe('github');
    expect(forgeKindFromEnv({ NEMUS_FORGE_HOST: 'gitlab' })).toBe('gitlab');
    expect(forgeKindFromEnv({ NEMUS_FORGE_HOST: '  gitlab  ' })).toBe('gitlab');
  });

  it('reads the host-specific API base var, per kind', () => {
    expect(forgeApiBaseFromEnv('github', { GITHUB_API_URL: 'https://ghe/api/v3' })).toBe('https://ghe/api/v3');
    expect(forgeApiBaseFromEnv('gitlab', { GITLAB_API_URL: 'https://gl/api/v4' })).toBe('https://gl/api/v4');
    // wrong-kind var is ignored
    expect(forgeApiBaseFromEnv('gitlab', { GITHUB_API_URL: 'https://ghe/api/v3' })).toBeUndefined();
    expect(forgeApiBaseFromEnv('github', {})).toBeUndefined();
  });
});
