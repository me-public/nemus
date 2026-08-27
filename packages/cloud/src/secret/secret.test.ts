import { describe, it, expect } from 'vitest';
import {
  EnvSecretSource,
  DotenvSecretSource,
  GhCliSecretSource,
  parseDotenv,
  resolveSecret,
  resolveSecretsToEnv,
  defaultSecretSources,
  SecretSources,
} from './index';

describe('EnvSecretSource', () => {
  it('reads a value and errors when unset/empty', async () => {
    const s = new EnvSecretSource({ FOO: 'bar', EMPTY: '' });
    expect(await s.resolve('FOO')).toBe('bar');
    await expect(s.resolve('EMPTY')).rejects.toThrow(/not set/);
    await expect(s.resolve('MISSING')).rejects.toThrow(/not set/);
  });
});

describe('parseDotenv / DotenvSecretSource', () => {
  const content = [
    '# a comment',
    'export GIT_TOKEN="ghp_abc"',
    "QUOTED='single'",
    'BARE=plainvalue',
    'WITH_SPACES = trimmed ',
    'not a valid line',
  ].join('\n');

  it('parses keys, quotes, export prefix, comments', () => {
    const p = parseDotenv(content);
    expect(p).toEqual({
      GIT_TOKEN: 'ghp_abc',
      QUOTED: 'single',
      BARE: 'plainvalue',
      WITH_SPACES: 'trimmed',
    });
  });

  it('resolves from injected content and errors on missing', async () => {
    const s = new DotenvSecretSource('.env', content);
    expect(await s.resolve('GIT_TOKEN')).toBe('ghp_abc');
    await expect(s.resolve('NOPE')).rejects.toThrow(/not found/);
  });
});

describe('GhCliSecretSource', () => {
  it('returns the gh token and passes --hostname for non-default hosts', async () => {
    const calls: string[][] = [];
    const s = new GhCliSecretSource(async (_bin, args) => {
      calls.push(args);
      return 'gho_token\n';
    });
    expect(await s.resolve()).toBe('gho_token');
    expect(calls[0]).toEqual(['auth', 'token']);
    await s.resolve('ghe.acme.com');
    expect(calls[1]).toEqual(['auth', 'token', '--hostname', 'ghe.acme.com']);
  });

  it('errors on empty token', async () => {
    const s = new GhCliSecretSource(async () => '  \n');
    await expect(s.resolve()).rejects.toThrow(/gh auth login/);
  });
});

describe('resolveSecret scheme dispatch', () => {
  const sources: SecretSources = {
    env: new EnvSecretSource({ GITHUB_TOKEN: 'e1' }),
    dotenv: new DotenvSecretSource('.env', 'GIT_TOKEN=d1'),
  };

  it('routes by scheme; bare name defaults to env', async () => {
    expect(await resolveSecret('env:GITHUB_TOKEN', sources)).toBe('e1');
    expect(await resolveSecret('dotenv:GIT_TOKEN', sources)).toBe('d1');
    expect(await resolveSecret('GITHUB_TOKEN', sources)).toBe('e1');
  });

  it('errors for an unknown scheme, listing known ones', async () => {
    await expect(resolveSecret('vault:x', sources)).rejects.toThrow(/no secret source for scheme "vault".*dotenv, env/s);
  });
});

describe('resolveSecretsToEnv', () => {
  const sources: SecretSources = {
    env: new EnvSecretSource({ T: 'tok', N: 'npm' }),
  };

  it('turns refs into an env map (the storeless-runner path)', async () => {
    const env = await resolveSecretsToEnv(
      [
        { name: 'GIT_TOKEN', from: 'env:T' },
        { name: 'NPM_TOKEN', from: 'env:N' },
      ],
      sources,
    );
    expect(env).toEqual({ GIT_TOKEN: 'tok', NPM_TOKEN: 'npm' });
  });

  it('returns {} for no secrets and blames the ref on failure', async () => {
    expect(await resolveSecretsToEnv(undefined, sources)).toEqual({});
    await expect(
      resolveSecretsToEnv([{ name: 'X', from: 'env:MISSING' }], sources),
    ).rejects.toThrow(/resolving secret "X" \(env:MISSING\)/);
  });

  it('defaultSecretSources exposes env + gh', () => {
    expect(Object.keys(defaultSecretSources({})).sort()).toEqual(['env', 'gh']);
  });
});
