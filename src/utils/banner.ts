import { colors } from './colors';

export const BANNER_PLAIN = `
    ╭──────────────────────────────────────╮
    │  >_  Nemus                           │
    │       multi-repo workspaces          │
    ╰──────────────────────────────────────╯
`;

// Rendered live (not captured at import) so --no-color / NO_COLOR applied before
// this is called produce a plain banner. With color off, every colors.* is ''.
export const renderBanner = (): string => {
  const { green: g, dim: d, bright: b, reset: r } = colors;
  return `
${d}    ╭──────────────────────────────────────╮${r}
${d}    │${r}  ${g}>_${r}  ${b}Nemus${r}                           ${d}│${r}
${d}    │${r}       ${d}multi-repo workspaces${r}          ${d}│${r}
${d}    ╰──────────────────────────────────────╯${r}
`;
};

export const printBanner = (): void => {
  console.log(renderBanner());
};

// The `--help` banner: a boxed splash with the version + tagline, width-fitted.
// Lives here alongside renderBanner() so the two renderers don't drift; also
// rendered live so --no-color / NO_COLOR yields a plain box.
export const renderHelpBanner = (version: string): string => {
  const { green: g, dim: d, bright: b, reset: r } = colors;
  const INNER = 38;
  const titleLine = `>_  Nemus`;
  const titlePad = ' '.repeat(Math.max(0, INNER - 2 - titleLine.length));
  const versionLine = `v${version} · multi-repo workspaces`;
  const versionPad = ' '.repeat(Math.max(0, INNER - 7 - versionLine.length));
  const bar = '─'.repeat(INNER);
  return `
${d}    ╭${bar}╮${r}
${d}    │${r}  ${g}>_${r}  ${b}Nemus${r}${titlePad}${d}│${r}
${d}    │${r}       ${d}${versionLine}${r}${versionPad}${d}│${r}
${d}    ╰${bar}╯${r}
`;
};
