import { logError } from '../utils/logger';
import { colorize } from '../utils/colors';
import { run } from '../cli/ai-prompt';

/**
 * Handle the `w -- <prompt>` command.
 * This is called directly from bin/workspace.js before Commander parses,
 * because Commander treats `--` as end-of-options.
 */
export async function handleAiPrompt(prompt: string): Promise<void> {
  if (!prompt || !prompt.trim()) {
    logError('No prompt provided');
    console.log(`\n  Usage: ${colorize('w -- <prompt>', 'green')}`);
    console.log(`  Example: ${colorize('w -- create a workspace for the payments team', 'gray')}\n`);
    process.exit(1);
    return;
  }

  const exitCode = await run(prompt.trim());
  process.exit(exitCode);
}
