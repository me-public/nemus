import { describe, it, expect } from 'vitest';
import { ShellGitOps } from './git-ops';
import { buildAgentCommand } from './agent-invoker';
import { Exec, ExecResultRaw, run, redactSecrets } from './exec';

/** Records git invocations and returns queued/derived results. */
function recorder(map: (bin: string, args: string[]) => ExecResultRaw = () => ({ code: 0, stdout: '', stderr: '' })) {
  const calls: { bin: string; args: string[]; cwd?: string }[] = [];
  const exec: Exec = async (bin, args, opts) => {
    calls.push({ bin, args, cwd: opts?.cwd });
    return map(bin, args);
  };
  return { exec, calls };
}

describe('ShellGitOps', () => {
  it('builds the expected git commands', async () => {
    const { exec, calls } = recorder();
    const git = new ShellGitOps({ exec, authorName: 'Bot', authorEmail: 'bot@x' });

    await git.clone('https://x-access-token:t@github.com/acme/api.git', '/workspace/api');
    await git.checkoutNewBranch('/workspace/api', 'nemus/feature');
    await git.commitAll('/workspace/api', 'msg');
    await git.push('/workspace/api', 'nemus/feature');

    expect(calls[0].args).toEqual(['clone', 'https://x-access-token:t@github.com/acme/api.git', '/workspace/api']);
    expect(calls[1].args).toEqual(['-C', '/workspace/api', 'checkout', '-b', 'nemus/feature']);
    expect(calls[2].args).toEqual(['-C', '/workspace/api', 'add', '-A']);
    // identity passed per-commit via -c (no global mutation)
    expect(calls[3].args).toEqual([
      '-C', '/workspace/api',
      '-c', 'user.name=Bot',
      '-c', 'user.email=bot@x',
      'commit', '-m', 'msg',
    ]);
    expect(calls[4].args).toEqual(['-C', '/workspace/api', 'push', '-u', 'origin', 'nemus/feature']);
  });

  it('hasChanges reflects porcelain output', async () => {
    const dirty = new ShellGitOps({ exec: recorder(() => ({ code: 0, stdout: ' M file\n', stderr: '' })).exec });
    const clean = new ShellGitOps({ exec: recorder(() => ({ code: 0, stdout: '', stderr: '' })).exec });
    expect(await dirty.hasChanges('/w')).toBe(true);
    expect(await clean.hasChanges('/w')).toBe(false);
  });

  it('throws with stderr on a failed git command', async () => {
    const git = new ShellGitOps({ exec: recorder(() => ({ code: 128, stdout: '', stderr: 'fatal: repo not found' })).exec });
    await expect(git.clone('u', '/d')).rejects.toThrow(/128.*repo not found/);
  });
});

describe('redactSecrets', () => {
  it('strips URL credentials (e.g. the tokenized clone URL)', () => {
    expect(redactSecrets('git clone https://x-access-token:ghs_SECRET@github.com/acme/api.git /w')).toBe(
      'git clone https://***@github.com/acme/api.git /w',
    );
    expect(redactSecrets('no creds here')).toBe('no creds here');
  });
});

describe('run() error redaction', () => {
  it('does not leak the token in the thrown error on a failed clone', async () => {
    const failing: Exec = async () => ({ code: 128, stdout: '', stderr: 'fatal: auth for https://x-access-token:ghs_SECRET@github.com/acme/api.git' });
    const url = 'https://x-access-token:ghs_SECRET@github.com/acme/api.git';
    await expect(run(failing, 'git', ['clone', url, '/w'])).rejects.toThrow(/\*\*\*@github\.com/);
    await expect(run(failing, 'git', ['clone', url, '/w'])).rejects.not.toThrow(/ghs_SECRET/);
  });
});

describe('buildAgentCommand', () => {
  it('defaults to pi headless', () => {
    expect(buildAgentCommand('pi', 'do it', {})).toEqual({ bin: 'pi', args: ['-p', 'do it'] });
    expect(buildAgentCommand('unknown', 'do it', {})).toEqual({ bin: 'pi', args: ['-p', 'do it'] });
  });

  it('claude uses -p + skip-permissions', () => {
    expect(buildAgentCommand('claude', 'do it', {})).toEqual({
      bin: 'claude',
      args: ['-p', 'do it', '--dangerously-skip-permissions'],
    });
  });

  it('NEMUS_AGENT_ARGS overrides and substitutes {task}', () => {
    expect(buildAgentCommand('pi', 'fix bug', { NEMUS_AGENT_ARGS: 'run --headless {task}' })).toEqual({
      bin: 'pi',
      args: ['run', '--headless', 'fix bug'],
    });
  });
});
