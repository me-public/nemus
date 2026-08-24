import { Command } from 'commander';

export function registerMcpCommands(parent: Command) {
  const mcp = parent
    .command('mcp')
    .description('MCP server management');

  mcp
    .command('install')
    .description('Register MCP server with Claude Code')
    .action(async () => {
      const { main } = await import('../../mcp/install');
      await main('install');
    });

  mcp
    .command('uninstall')
    .description('Unregister the MCP server')
    .action(async () => {
      const { main } = await import('../../mcp/install');
      await main('uninstall');
    });

  mcp
    .command('upgrade')
    .description('Update hooks and skills (no MCP re-register)')
    .action(async () => {
      const { main } = await import('../../mcp/install');
      await main('upgrade');
    });

  mcp
    .command('status')
    .description('Check MCP server registration')
    .action(async () => {
      const { main } = await import('../../mcp/install');
      await main('status');
    });
}
