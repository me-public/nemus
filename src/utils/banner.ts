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
