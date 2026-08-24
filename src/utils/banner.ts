import { colors } from './colors';

const g = colors.green;
const d = colors.dim;
const b = colors.bright;
const r = colors.reset;

export const BANNER = `
${d}    ╭──────────────────────────────────────╮${r}
${d}    │${r}  ${g}>_${r}  ${b}Nemus${r}                           ${d}│${r}
${d}    │${r}       ${d}multi-repo workspaces${r}          ${d}│${r}
${d}    ╰──────────────────────────────────────╯${r}
`;

export const BANNER_PLAIN = `
    ╭──────────────────────────────────────╮
    │  >_  Nemus                           │
    │       multi-repo workspaces          │
    ╰──────────────────────────────────────╯
`;

export const printBanner = (): void => {
  console.log(BANNER);
};
