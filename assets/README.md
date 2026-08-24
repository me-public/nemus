# Nemus brand assets

Original artwork for **Nemus**. The mark is a **branch/tree node graph** — a git-style
DAG of nodes that reads at once as a *tree* (the name Nemus), a *commit/branch graph*,
and a set of *repositories* joined into one workspace. The hero imagery uses a
terminal-window motif in a GitHub-dark palette for a developer-native feel.

## Files

| File | Use |
|------|-----|
| `logo.svg` / `logo-256.png` / `logo-512.png` | The logo mark. Transparent background — use on light or dark surfaces. |
| `logo-wordmark.svg` | Mark + "Nemus" wordmark. Use in README headers and docs. |
| `icon.svg` / `icon-256.png` | Square app icon (rounded-rect green background). Use for avatars/app icons. |
| `favicon-32.png` / `favicon-64.png` | Favicons derived from the icon. |
| `banner.svg` / `banner.png` | 1280×640 social/repo banner (GitHub "social preview"). |

## Color palette

GitHub-familiar greens on a dark canvas.

| Token | Hex | Use |
|-------|-----|-----|
| Green (primary) | `#3FB950` | Primary brand green (nodes) |
| Green (deep) | `#238636` / `#2EA043` | Edges, gradients, wordmark on light/dark |
| Green (bright) | `#56D364` | Node highlights |
| Mint | `#7EE2A8` | Accent / subtitle text on dark |
| Canvas | `#0D1117` / `#0A0E14` | Dark backgrounds (banner, icon) |
| Panel | `#161B22` | Terminal window / tile surface |
| Border | `#30363D` | Hairline borders |
| Text | `#E6EDF3` | Primary text on dark |
| Muted | `#7D8590` / `#8B949E` | Secondary text |

Terminal traffic-light dots: `#FF5F56` `#FFBD2E` `#27C93F`.

## Regenerating the PNGs

The PNGs are rasterized from the SVGs with [`rsvg-convert`](https://gitlab.gnome.org/GNOME/librsvg)
(or ImageMagick's `magick`):

```bash
rsvg-convert -w 512 -h 512 logo.svg  -o logo-512.png
rsvg-convert -w 256 -h 256 logo.svg  -o logo-256.png
rsvg-convert -w 256 -h 256 icon.svg  -o icon-256.png
rsvg-convert -w 64  -h 64  icon.svg  -o favicon-64.png
rsvg-convert -w 32  -h 32  icon.svg  -o favicon-32.png
rsvg-convert -w 1280 -h 640 banner.svg -o banner.png
```

All artwork is original and released under the project's [MIT license](../LICENSE).
