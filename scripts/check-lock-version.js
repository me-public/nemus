#!/usr/bin/env node
/**
 * CI guard: fail if package-lock.json's version fields drift from package.json.
 *
 * A stale lockfile version makes `npm ci` fail at release time (npm errors on a
 * package.json/lock mismatch before build/publish run). This catches the drift
 * in PR CI instead. Checks both the lockfile root `version` and the self entry
 * at `packages[""]`.
 *
 * Usage: node scripts/check-lock-version.js
 * Exit 0 when consistent, 1 (with an ::error:: annotation) otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}

const pkg = read('package.json');
const lock = read('package-lock.json');

const pkgV = pkg.version;
const rootV = lock.version;
const selfV = lock.packages && lock.packages[''] && lock.packages[''].version;

const errs = [];
if (rootV !== pkgV) {
  errs.push(`package-lock.json root version "${rootV}" != package.json "${pkgV}"`);
}
if (selfV !== pkgV) {
  errs.push(`package-lock.json packages[""] version "${selfV}" != package.json "${pkgV}"`);
}

if (errs.length) {
  console.error('::error::' + errs.join('; '));
  console.error('Fix: run `npm install --package-lock-only` and commit package-lock.json.');
  process.exit(1);
}

console.log(`\u2713 package-lock.json version matches package.json (${pkgV})`);
