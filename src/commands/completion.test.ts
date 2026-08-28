import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateCompletion, specsFromProgram, CommandSpec } from './completion';

const specs: CommandSpec[] = [
  { name: 'list', aliases: ['l'], takesWorkspace: false, description: 'List workspaces' },
  { name: 'status', aliases: ['st'], takesWorkspace: true, description: "Show a repo's git status" },
  { name: 'doctor', aliases: ['doc'], takesWorkspace: true, description: 'Health checks' },
];

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
});
