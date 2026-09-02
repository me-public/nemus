/**
 * Interactive prompt primitives.
 *
 * We depend on the modular `@inquirer/prompts` (the maintained successor to the
 * classic `inquirer` package and its `inquirer-autocomplete-prompt` plugin).
 * All prompt call sites import from HERE, not from `@inquirer/prompts` directly,
 * so there is a single place to:
 *   - centralize the ESM-only package (loaded from our CommonJS build via
 *     Node 22's stable `require(esm)` — the CLI requires Node >= 22), and
 *   - stub prompts in tests (mock '../utils/prompt').
 *
 * The classic array API (`inquirer.prompt([{ type, name, message }])` returning
 * `{ name: value }`) is replaced by these functions, which take an options
 * object and return the answer VALUE directly.
 */
export { confirm, input, select, checkbox, password, search, Separator } from '@inquirer/prompts';
