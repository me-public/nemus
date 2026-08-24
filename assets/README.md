# Grove brand assets

Original artwork for **Grove**. The mark is a *grove of three trees* growing out of
a `>_` terminal prompt — repositories (trees) cultivated from the command line.

## Files

| File | Use |
|------|-----|
| `logo.svg` / `logo-256.png` / `logo-512.png` | The logo mark. Transparent background — use on light or dark surfaces. |
| `logo-wordmark.svg` | Mark + "Grove" wordmark. Use in README headers and docs. |
| `icon.svg` / `icon-256.png` | Square app icon (rounded-rect green background). Use for avatars/app icons. |
| `favicon-32.png` / `favicon-64.png` | Favicons derived from the icon. |
| `banner.svg` / `banner.png` | 1280×640 social/repo banner (GitHub "social preview"). |

## Color palette

| Token | Hex | Use |
|-------|-----|-----|
| Canopy (primary) | `#3DA35D` | Primary brand green (main foliage) |
| Forest | `#2E7D48` | Secondary foliage / accents |
| Pine (dark) | `#1B4332` | Trunks, prompt, dark backgrounds, text on light |
| Deep pine | `#0F2C1E` / `#143728` | Darkest shade (icon trunks, gradient base) |
| Sprout | `#57C77E` | Lighter foliage / highlights |
| Mint | `#A7E0BE` | Light accent, cursor, subtitle text on dark |
| Paper | `#F7FFF9` | Near-white for separation rings / text on dark |

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
