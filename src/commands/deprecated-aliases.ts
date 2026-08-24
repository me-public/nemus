import { Command } from 'commander';

interface DeprecatedAlias {
  name: string;
  target: [string, string]; // [group, subcommand]
}

const DEPRECATED_SHORT_ALIASES: DeprecatedAlias[] = [
  { name: 'sc', target: ['suite', 'create'] },
  { name: 'sls', target: ['suite', 'list'] },
  { name: 'sd', target: ['suite', 'delete'] },
  { name: 'se', target: ['suite', 'export'] },
  { name: 'si', target: ['suite', 'import'] },
  { name: 'fs', target: ['suite', 'use'] },
  { name: 'sb', target: ['branch', 'switch'] },
  { name: 'bc', target: ['branch', 'create'] },
  { name: 'bm', target: ['branch', 'merge'] },
  { name: 'br', target: ['branch', 'rebase'] },
  { name: 'uc', target: ['cache', 'refresh'] },
];

const DEPRECATED_FLAT_COMMANDS: DeprecatedAlias[] = [
  { name: 'suite-create', target: ['suite', 'create'] },
  { name: 'suite-list', target: ['suite', 'list'] },
  { name: 'suite-delete', target: ['suite', 'delete'] },
  { name: 'suite-export', target: ['suite', 'export'] },
  { name: 'suite-import', target: ['suite', 'import'] },
  { name: 'from-suite', target: ['suite', 'use'] },
  { name: 'switch-branch', target: ['branch', 'switch'] },
  { name: 'branch-create', target: ['branch', 'create'] },
  { name: 'branch-merge', target: ['branch', 'merge'] },
  { name: 'branch-rebase', target: ['branch', 'rebase'] },
  { name: 'update-cache', target: ['cache', 'refresh'] },
];

export function registerDeprecatedAliases(program: Command) {
  const all = [...DEPRECATED_SHORT_ALIASES, ...DEPRECATED_FLAT_COMMANDS];

  for (const alias of all) {
    program
      .command(alias.name, { hidden: true })
      .allowUnknownOption()
      .allowExcessArguments()
      .action(async () => {
        const [group, sub] = alias.target;
        process.stderr.write(
          `[grove] "w ${alias.name}" is deprecated, use "w ${group} ${sub}" instead\n`
        );
        // Re-parse with the correct group + subcommand
        await program.parseAsync(
          [process.argv[0], process.argv[1], group, sub, ...process.argv.slice(3)]
        );
      });
  }
}
