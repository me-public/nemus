import { Exec, run, shellExec } from './exec';
import { GitOps } from './types';

export interface ShellGitOpsOptions {
  exec?: Exec;
  /** Commit identity (a bot). */
  authorName?: string;
  authorEmail?: string;
}

/** GitOps that shells the real `git` CLI. Identity is passed per-commit with
 *  `-c` so we never mutate global git config. `exec` is injectable for tests. */
export class ShellGitOps implements GitOps {
  private readonly exec: Exec;
  private readonly name: string;
  private readonly email: string;

  constructor(opts: ShellGitOpsOptions = {}) {
    this.exec = opts.exec ?? shellExec;
    this.name = opts.authorName ?? 'Nemus Agent';
    this.email = opts.authorEmail ?? 'nemus-agent@users.noreply.github.com';
  }

  async clone(url: string, dir: string): Promise<void> {
    await run(this.exec, 'git', ['clone', url, dir]);
  }

  async checkoutNewBranch(dir: string, branch: string): Promise<void> {
    await run(this.exec, 'git', ['-C', dir, 'checkout', '-b', branch]);
  }

  async hasChanges(dir: string): Promise<boolean> {
    const { stdout } = await run(this.exec, 'git', ['-C', dir, 'status', '--porcelain']);
    return stdout.trim().length > 0;
  }

  async commitAll(dir: string, message: string): Promise<void> {
    await run(this.exec, 'git', ['-C', dir, 'add', '-A']);
    await run(this.exec, 'git', [
      '-C', dir,
      '-c', `user.name=${this.name}`,
      '-c', `user.email=${this.email}`,
      'commit', '-m', message,
    ]);
  }

  async push(dir: string, branch: string): Promise<void> {
    await run(this.exec, 'git', ['-C', dir, 'push', '-u', 'origin', branch]);
  }
}
