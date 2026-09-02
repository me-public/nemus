#!/usr/bin/env node
// Emit GitHub Release notes for a given version by extracting that version's
// section from CHANGELOG.md (newest-first "Keep a Changelog" format), prepended
// with an install snippet and followed by a compare link to the previous tag.
//
// Usage: node scripts/release-notes.mjs <version> [repo]
//   repo defaults to $GITHUB_REPOSITORY or "me-public/nemus".
//
// If the version has no CHANGELOG section, prints a minimal fallback (so a
// release is never blocked on a missing entry). Dependency-free; prints to
// stdout so the workflow can redirect it into `gh release --notes-file`.
import { readFileSync } from 'node:fs';

const version = (process.argv[2] || '').trim();
const repo = (process.argv[3] || process.env.GITHUB_REPOSITORY || 'me-public/nemus').trim();
if (!version) {
  process.stderr.write('usage: release-notes.mjs <version> [repo]\n');
  process.exit(2);
}

const install = `\`\`\`bash\nnpm install -g @nemus-cli/nemus@${version}\n\`\`\``;

let body = '';
let prev = null;
try {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const lines = changelog.split('\n');
  // Collect version headers in file order (newest first) with their line index.
  const heads = [];
  lines.forEach((line, i) => {
    const m = line.match(/^## \[(\d+\.\d+\.\d+)\]/);
    if (m) heads.push({ version: m[1], line: i });
  });
  const idx = heads.findIndex((h) => h.version === version);
  if (idx !== -1) {
    const start = heads[idx].line + 1;
    const end = idx + 1 < heads.length ? heads[idx + 1].line : lines.length;
    body = lines.slice(start, end).join('\n').trim();
    // Newest-first: the NEXT header in the file is the previous release.
    prev = idx + 1 < heads.length ? heads[idx + 1].version : null;
  }
} catch {
  // fall through to fallback
}

const compare = prev
  ? `[\`v${prev}...v${version}\`](https://github.com/${repo}/compare/v${prev}...v${version})`
  : `[\`v${version}\`](https://github.com/${repo}/releases/tag/v${version})`;

const parts = [`## Nemus v${version}`, '', install];
if (body) parts.push('', body);
parts.push('', '---', '', `**Full diff:** ${compare} · [Full changelog](https://github.com/${repo}/blob/main/CHANGELOG.md)`);

process.stdout.write(parts.join('\n') + '\n');
