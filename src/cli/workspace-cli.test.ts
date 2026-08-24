import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const BIN = path.join(__dirname, '..', '..', 'bin', 'workspace.js');

describe('w CLI entry point', () => {
  it('--version prints version number', () => {
    const output = execSync(`node ${BIN} --version 2>/dev/null`).toString().trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('-V prints version number', () => {
    const output = execSync(`node ${BIN} -V 2>/dev/null`).toString().trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--version and -V print the same version', () => {
    const v1 = execSync(`node ${BIN} --version 2>/dev/null`).toString().trim();
    const v2 = execSync(`node ${BIN} -V 2>/dev/null`).toString().trim();
    expect(v1).toBe(v2);
  });

  it('help banner includes version', () => {
    const output = execSync(`node ${BIN} --help 2>/dev/null`).toString();
    expect(output).toContain('multi-repo workspaces');
    // Version should appear in format "vX.Y.Z"
    expect(output).toMatch(/v\d+\.\d+\.\d+/);
  });
});
