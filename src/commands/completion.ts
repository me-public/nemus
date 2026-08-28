import { Command } from 'commander';
import { listWorkspaces } from '../utils/workspace-meta';
import { logError } from '../utils/logger';

/** Binaries that get completion registered (the CLI's bins). */
export const COMPLETION_BINS = ['nemus', 'nem'];

export type Shell = 'bash' | 'zsh' | 'fish';

/** One top-level command, distilled to what a completion script needs. */
export interface CommandSpec {
  name: string;
  aliases: string[];
  /** True if its first positional argument is a workspace name. */
  takesWorkspace: boolean;
  description: string;
}

/** Every token (name + aliases) that should complete as a subcommand. */
function allTokens(cmds: CommandSpec[]): string[] {
  return cmds.flatMap((c) => [c.name, ...c.aliases]);
}

/** Tokens (names + aliases) of the commands that take a workspace argument. */
function workspaceTokens(cmds: CommandSpec[]): string[] {
  return cmds.filter((c) => c.takesWorkspace).flatMap((c) => [c.name, ...c.aliases]);
}

/** Escape a description for a fish single-quoted string. */
function fishDesc(s: string): string {
  return s.replace(/\n/g, ' ').replace(/'/g, "'\\''");
}

/**
 * Generate a shell completion script. Pure (no I/O) so it's unit-tested. The
 * generated script completes subcommands at position 1, and for a subcommand
 * that takes a workspace it completes workspace names by calling back into the
 * CLI: `<bin> completion --workspaces`. Dynamic values stay fresh without
 * regenerating the script.
 */
export function generateCompletion(shell: Shell, cmds: CommandSpec[], bins: string[] = COMPLETION_BINS): string {
  const commands = allTokens(cmds).join(' ');
  const wsCommands = workspaceTokens(cmds).join(' ');

  if (shell === 'bash') {
    return `# nemus bash completion. Install: nemus completion bash > /etc/bash_completion.d/nemus
#   (or: nemus completion bash >> ~/.bashrc)
_nemus_complete() {
  local cur bin sub
  # bash does not clear COMPREPLY between completions; reset so a stale result
  # from a previous TAB can't leak when we return without setting it.
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  bin="\${COMP_WORDS[0]}"
  local commands="${commands}"
  local ws_commands="${wsCommands}"
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "\$commands" -- "\$cur") )
    return 0
  fi
  if [ "\$COMP_CWORD" -eq 2 ]; then
    sub="\${COMP_WORDS[1]}"
    if [[ " \$ws_commands " == *" \$sub "* ]]; then
      local names
      names="\$("\$bin" completion --workspaces 2>/dev/null)"
      COMPREPLY=( \$(compgen -W "\$names" -- "\$cur") )
      return 0
    fi
  fi
  return 0
}
${bins.map((b) => `complete -F _nemus_complete ${b}`).join('\n')}
`;
  }

  if (shell === 'zsh') {
    // Autoloaded form: save as a file named `_nemus` on your $fpath.
    return `#compdef ${bins.join(' ')}
# nemus zsh completion. Install: nemus completion zsh > "\${fpath[1]}/_nemus"
local -a _nemus_commands
_nemus_commands=(${allTokens(cmds).map((t) => `'${t}'`).join(' ')})
local _nemus_ws_commands="${wsCommands}"
if (( CURRENT == 2 )); then
  compadd -- $_nemus_commands
  return
fi
if (( CURRENT == 3 )); then
  local sub=\${words[2]}
  if [[ " $_nemus_ws_commands " == *" $sub "* ]]; then
    local -a _nemus_names
    _nemus_names=(\${(f)"$(\${words[1]} completion --workspaces 2>/dev/null)"})
    compadd -- $_nemus_names
  fi
fi
`;
  }

  // fish
  const lines: string[] = ['# nemus fish completion. Install: nemus completion fish > ~/.config/fish/completions/nemus.fish'];
  for (const bin of bins) {
    lines.push(`complete -c ${bin} -f`);
    for (const c of cmds) {
      for (const tok of [c.name, ...c.aliases]) {
        lines.push(`complete -c ${bin} -n __fish_use_subcommand -a '${tok}' -d '${fishDesc(c.description)}'`);
      }
    }
    const wsToks = workspaceTokens(cmds).join(' ');
    if (wsToks) {
      lines.push(
        `complete -c ${bin} -n '__fish_seen_subcommand_from ${wsToks}' -a '(${bin} completion --workspaces)'`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

/** Distill the program's top-level commands into CommandSpecs. */
export function specsFromProgram(program: Command): CommandSpec[] {
  return program.commands
    .map((c) => {
      const args = (c as any).registeredArguments ?? [];
      const firstArg: string | undefined = args[0]?.name?.();
      return {
        name: c.name(),
        aliases: c.aliases(),
        takesWorkspace: typeof firstArg === 'string' && firstArg.toLowerCase().includes('workspace'),
        description: c.description() ?? '',
      };
    })
    // The completion command itself and any hidden helper needn't clutter, but
    // keeping them is harmless; only drop entries with no name.
    .filter((s) => s.name);
}

export function registerCompletionCommand(program: Command) {
  program
    .command('completion [shell]')
    .description('Output a shell completion script (bash|zsh|fish)')
    .option('--workspaces', 'Print workspace names (used internally by completion scripts)')
    .action(async (shell: string | undefined, opts: { workspaces?: boolean }) => {
      // Data helper the generated scripts call back into.
      if (opts.workspaces) {
        try {
          const workspaces = await listWorkspaces(false);
          for (const ws of workspaces) process.stdout.write(ws.name + '\n');
        } catch {
          // Silent: completion must never error out the user's shell.
        }
        return;
      }

      const shells: Shell[] = ['bash', 'zsh', 'fish'];
      if (!shell || !shells.includes(shell as Shell)) {
        logError(`completion: specify a shell — one of ${shells.join(', ')}`);
        logError('e.g. nemus completion bash');
        process.exit(1);
      }
      process.stdout.write(generateCompletion(shell as Shell, specsFromProgram(program)));
    });
}
