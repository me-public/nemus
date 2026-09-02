import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { generateCompletion, specsFromProgram, detectShell, registerCompletionCommand, CommandSpec } from './completion';

const specs: CommandSpec[] = [
  { name: 'list', aliases: ['l'], takesWorkspace: false, description: 'List workspaces' },
  { name: 'status', aliases: ['st'], takesWorkspace: true, description: "Show a repo's git status" },
  { name: 'doctor', aliases: ['doc'], takesWorkspace: true, description: 'Health checks' },
];

// A spec set exercising second-level subcommands and third-level value completion.
const subSpecs: CommandSpec[] = [
  {
    name: 'config', aliases: [], takesWorkspace: false, description: 'Configure',
    subcommands: ['get', 'set', 'list', 'ls'],
    argValues: { after: ['get', 'set'], values: ['githubOrg', 'cloneProtocol'] },
  },
  { name: 'reflect', aliases: ['retro'], takesWorkspace: false, description: 'Retrospective', subcommands: ['history', 'show'] },
];

describe('detectShell', () => {
  it('infers the shell from a $SHELL-style path', () => {
    expect(detectShell('/bin/zsh')).toBe('zsh');
    expect(detectShell('/usr/bin/fish')).toBe('fish');
    expect(detectShell('/bin/bash')).toBe('bash');
  });
  it('returns null for unknown/empty values', () => {
    expect(detectShell('/bin/tcsh')).toBeNull();
    expect(detectShell('')).toBeNull();
    expect(detectShell(undefined)).toBeNull();
  });
});

describe('generateCompletion — second/third level', () => {
  it('bash completes subcommands and config-key values, and stays valid', () => {
    const s = generateCompletion('bash', subSpecs);
    expect(s).toContain('config) echo "get set list ls" ;;');
    expect(s).toContain('reflect|retro) echo "history show" ;;');
    expect(s).toContain('case "$2" in get|set) echo "githubOrg cloneProtocol"');
  });
  it('zsh completes subcommands and values at CURRENT 3/4', () => {
    const s = generateCompletion('zsh', subSpecs);
    expect(s).toContain('config) compadd -- get set list ls ;;');
    expect(s).toContain('reflect|retro) compadd -- history show ;;');
    expect(s).toContain('case ${words[3]} in get|set) compadd -- githubOrg cloneProtocol');
  });
  it('fish emits seen-subcommand conditions for subcommands and values', () => {
    const s = generateCompletion('fish', subSpecs);
    expect(s).toContain("-n '__fish_seen_subcommand_from config' -a 'get set list ls'");
    expect(s).toContain("__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set");
  });
});

describe('generateCompletion — bash', () => {
  const s = generateCompletion('bash', specs);
  it('resets COMPREPLY, lists tokens, and registers both bins', () => {
    expect(s).toContain('COMPREPLY=()'); // guards the stale-completion leak
    expect(s).toContain('local commands="list l status st doctor doc"');
    expect(s).toContain('local ws_commands="status st doctor doc"');
    expect(s).toContain('complete -F _nemus_complete nemus');
    expect(s).toContain('complete -F _nemus_complete nem');
  });
  it('calls back into the invoked bin for workspace names', () => {
    expect(s).toContain('"$bin" completion --workspaces');
  });
});

describe('generateCompletion — zsh', () => {
  const s = generateCompletion('zsh', specs);
  it('is an autoloadable #compdef script with the tokens + callback', () => {
    expect(s.startsWith('#compdef nemus nem')).toBe(true);
    expect(s).toContain("_nemus_commands=('list' 'l' 'status' 'st' 'doctor' 'doc')");
    expect(s).toContain('_nemus_ws_commands="status st doctor doc"');
    expect(s).toContain('completion --workspaces');
  });
});

describe('generateCompletion — fish', () => {
  const s = generateCompletion('fish', specs);
  it('emits subcommand + workspace completions for both bins with escaped descriptions', () => {
    expect(s).toContain("complete -c nemus -n __fish_use_subcommand -a 'list' -d 'List workspaces'");
    expect(s).toContain("complete -c nem -n __fish_use_subcommand -a 'status'");
    // apostrophe in the description is escaped for fish's single-quoted string
    expect(s).toContain("Show a repo'\\''s git status");
    expect(s).toContain("-n '__fish_seen_subcommand_from status st doctor doc' -a '(nemus completion --workspaces)'");
  });
});

describe('registerCompletionCommand — stdout hygiene on inferred shell', () => {
  it('writes ONLY the script to stdout; the $SHELL inference note goes to stderr', async () => {
    // The documented install path is `nemus completion zsh > _nemus`, so if the
    // inference note leaked to stdout it would corrupt the generated script.
    const program = new Command();
    program.exitOverride();
    program.command('list').description('list');
    registerCompletionCommand(program);

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    }) as typeof process.stdout.write);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prevShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';

    let errCalls: string[] = [];
    try {
      await program.parseAsync(['node', 'nemus', 'completion']);
      errCalls = errSpy.mock.calls.map((c) => c.map(String).join(' '));
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
      stdoutSpy.mockRestore();
      errSpy.mockRestore();
    }

    const stdout = stdoutChunks.join('');
    expect(stdout.startsWith('#compdef')).toBe(true); // the zsh script, nothing prepended
    expect(stdout).not.toContain('no shell given'); // the note never reached stdout
    expect(errCalls.some((l) => l.includes('no shell given'))).toBe(true); // it went to stderr
  });
});

describe('specsFromProgram', () => {
  it('detects workspace args + aliases from a commander program', () => {
    const program = new Command();
    program.command('list').alias('l').description('list');
    program.command('status [workspace]').alias('st').description('status');
    program.command('create').description('create');

    const out = specsFromProgram(program);
    const byName = Object.fromEntries(out.map((s) => [s.name, s]));
    expect(byName.status.takesWorkspace).toBe(true);
    expect(byName.status.aliases).toEqual(['st']);
    expect(byName.list.takesWorkspace).toBe(false);
    expect(byName.create.takesWorkspace).toBe(false);
  });

  it('derives nested subcommands, the reflect override, and config keys', () => {
    const program = new Command();
    const cfg = program.command('config').description('config');
    cfg.command('get').description('get');
    cfg.command('set').description('set');
    program.command('reflect').description('reflect'); // positional subcommands
    program.command('list').description('list');

    const byName = Object.fromEntries(specsFromProgram(program).map((s) => [s.name, s]));
    // nested commander subcommands are auto-derived
    expect(byName.config.subcommands).toContain('get');
    expect(byName.config.subcommands).toContain('set');
    // reflect's positional subcommands come from the override
    expect(byName.reflect.subcommands).toEqual(['history', 'show']);
    // config gets key-value completion from the authoritative CONFIG_KEYS
    expect(byName.config.argValues?.after).toEqual(['get', 'set', 'unset']);
    expect(byName.config.argValues?.values).toContain('githubOrg');
    // a plain command has neither
    expect(byName.list.subcommands).toBeUndefined();
    expect(byName.list.argValues).toBeUndefined();
  });
});
