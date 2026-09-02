import { Command } from 'commander';
import { listWorkspaces } from '../utils/workspace-meta';
import { logError, logInfo } from '../utils/logger';
import { CONFIG_KEYS } from '../utils/config-schema';

/** Binaries that get completion registered (the CLI's bins). */
export const COMPLETION_BINS = ['nemus', 'nem'];

export type Shell = 'bash' | 'zsh' | 'fish';
export const SHELLS: Shell[] = ['bash', 'zsh', 'fish'];

/** Commands whose subcommands are positional args (not nested commander commands). */
const POSITIONAL_SUBCOMMANDS: Record<string, string[]> = { reflect: ['history', 'show'] };

/** One top-level command, distilled to what a completion script needs. */
export interface CommandSpec {
  name: string;
  aliases: string[];
  /** True if its first positional argument is a workspace name. */
  takesWorkspace: boolean;
  description: string;
  /** Second-level tokens (e.g. `config get`, `reflect history`), if any. */
  subcommands?: string[];
  /** Third-level value completion: for these subcommands, complete `values`. */
  argValues?: { after: string[]; values: string[] };
}

/**
 * Infer a shell from a `$SHELL`-style path (e.g. `/bin/zsh` -> `zsh`). Returns
 * null for an unknown/empty value. Pure + exported for testing.
 */
export function detectShell(shellPath: string | undefined): Shell | null {
  if (!shellPath) return null;
  const base = shellPath.trim().split('/').pop()?.toLowerCase() ?? '';
  return SHELLS.find((s) => s === base) ?? null;
}

/** Every token (name + aliases) that should complete as a subcommand. */
function allTokens(cmds: CommandSpec[]): string[] {
  return cmds.flatMap((c) => [c.name, ...c.aliases]);
}

/** Tokens (names + aliases) of the commands that take a workspace argument. */
function workspaceTokens(cmds: CommandSpec[]): string[] {
  return cmds.filter((c) => c.takesWorkspace).flatMap((c) => [c.name, ...c.aliases]);
}

/** All tokens (name + aliases) that route to a given command spec. */
function cmdTokens(c: CommandSpec): string[] {
  return [c.name, ...c.aliases];
}

/** Escape a description for a fish single-quoted string. */
function fishDesc(s: string): string {
  return s.replace(/\n/g, ' ').replace(/'/g, "'\\''");
}

/**
 * Generate a shell completion script. Pure (no I/O) so it's unit-tested. The
 * generated script completes, in order: top-level commands (position 1); then
 * either workspace names (for workspace-scoped commands) or a command's own
 * subcommands (position 2); then value completions like `config` keys
 * (position 3). Workspace names stay dynamic via a callback into
 * `<bin> completion --workspaces`.
 */
export function generateCompletion(shell: Shell, cmds: CommandSpec[], bins: string[] = COMPLETION_BINS): string {
  const commands = allTokens(cmds).join(' ');
  const wsCommands = workspaceTokens(cmds).join(' ');
  const withSubs = cmds.filter((c) => c.subcommands && c.subcommands.length);
  const withArgVals = cmds.filter((c) => c.argValues && c.argValues.values.length);

  if (shell === 'bash') {
    const subArms = withSubs
      .map((c) => `    ${cmdTokens(c).join('|')}) echo "${c.subcommands!.join(' ')}" ;;`)
      .join('\n');
    const argArms = withArgVals
      .map(
        (c) =>
          `    ${cmdTokens(c).join('|')}) case "$2" in ${c.argValues!.after.join('|')}) echo "${c.argValues!.values.join(' ')}" ;; esac ;;`,
      )
      .join('\n');
    return `# nemus bash completion. Install: nemus completion bash > /etc/bash_completion.d/nemus
#   (or: nemus completion bash >> ~/.bashrc)
_nemus_subcmds() {
  case "$1" in
${subArms}
  esac
}
_nemus_argvals() {
  case "$1" in
${argArms}
  esac
}
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
    local subs
    subs="\$(_nemus_subcmds "\$sub")"
    if [ -n "\$subs" ]; then
      COMPREPLY=( \$(compgen -W "\$subs" -- "\$cur") )
    fi
    return 0
  fi
  if [ "\$COMP_CWORD" -eq 3 ]; then
    local vals
    vals="\$(_nemus_argvals "\${COMP_WORDS[1]}" "\${COMP_WORDS[2]}")"
    if [ -n "\$vals" ]; then
      COMPREPLY=( \$(compgen -W "\$vals" -- "\$cur") )
    fi
    return 0
  fi
  return 0
}
${bins.map((b) => `complete -F _nemus_complete ${b}`).join('\n')}
`;
  }

  if (shell === 'zsh') {
    const subArms = withSubs
      .map((c) => `      ${cmdTokens(c).join('|')}) compadd -- ${c.subcommands!.join(' ')} ;;`)
      .join('\n');
    const argArms = withArgVals
      .map(
        (c) =>
          `      ${cmdTokens(c).join('|')}) case \${words[3]} in ${c.argValues!.after.join('|')}) compadd -- ${c.argValues!.values.join(' ')} ;; esac ;;`,
      )
      .join('\n');
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
    return
  fi
  case $sub in
${subArms}
  esac
  return
fi
if (( CURRENT == 4 )); then
  case \${words[2]} in
${argArms}
  esac
fi
`;
  }

  // fish
  const lines: string[] = ['# nemus fish completion. Install: nemus completion fish > ~/.config/fish/completions/nemus.fish'];
  for (const bin of bins) {
    lines.push(`complete -c ${bin} -f`);
    for (const c of cmds) {
      for (const tok of cmdTokens(c)) {
        lines.push(`complete -c ${bin} -n __fish_use_subcommand -a '${tok}' -d '${fishDesc(c.description)}'`);
      }
    }
    const wsToks = workspaceTokens(cmds).join(' ');
    if (wsToks) {
      lines.push(
        `complete -c ${bin} -n '__fish_seen_subcommand_from ${wsToks}' -a '(${bin} completion --workspaces)'`,
      );
    }
    // Second-level subcommands.
    for (const c of withSubs) {
      lines.push(
        `complete -c ${bin} -n '__fish_seen_subcommand_from ${cmdTokens(c).join(' ')}' -a '${c.subcommands!.join(' ')}'`,
      );
    }
    // Third-level value completions (e.g. config keys after get/set/unset).
    for (const c of withArgVals) {
      lines.push(
        `complete -c ${bin} -n '__fish_seen_subcommand_from ${cmdTokens(c).join(' ')}; and __fish_seen_subcommand_from ${c.argValues!.after.join(' ')}' -a '${c.argValues!.values.join(' ')}'`,
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
      const name = c.name();
      // Nested commander subcommands (config/suite/branch/cache/mcp), else a
      // manual override for commands whose subcommands are positional (reflect).
      const nested = c.commands.flatMap((s) => [s.name(), ...s.aliases()]).filter(Boolean);
      const subcommands = nested.length ? nested : POSITIONAL_SUBCOMMANDS[name];
      const argValues =
        name === 'config' ? { after: ['get', 'set', 'unset'], values: [...CONFIG_KEYS] } : undefined;
      return {
        name,
        aliases: c.aliases(),
        takesWorkspace: typeof firstArg === 'string' && firstArg.toLowerCase().includes('workspace'),
        description: c.description() ?? '',
        ...(subcommands ? { subcommands } : {}),
        ...(argValues ? { argValues } : {}),
      };
    })
    // The completion command itself and any hidden helper needn't clutter, but
    // keeping them is harmless; only drop entries with no name.
    .filter((s) => s.name);
}

export function registerCompletionCommand(program: Command) {
  program
    .command('completion [shell]')
    .description('Output a shell completion script (bash|zsh|fish; inferred from $SHELL if omitted)')
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

      // An explicit argument wins; only fall back to $SHELL when none is given
      // (an invalid explicit arg is an error, not a reason to guess).
      let target: Shell | null = null;
      if (shell) {
        target = SHELLS.includes(shell as Shell) ? (shell as Shell) : null;
      } else {
        target = detectShell(process.env.SHELL);
        if (target) logInfo(`completion: no shell given — using ${target} (from $SHELL)`);
      }

      if (!target) {
        logError(`completion: specify a shell — one of ${SHELLS.join(', ')}`);
        logError('e.g. nemus completion bash');
        process.exit(1);
      }
      process.stdout.write(generateCompletion(target, specsFromProgram(program)));
    });
}
