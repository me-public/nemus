import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

vi.mock('./logger', () => ({
  logSuccess: vi.fn(),
  logWarning: vi.fn(),
}));

vi.mock('./colors', () => ({
  colorize: (text: string) => text,
}));

// Default to 'both' agent config for tests
vi.mock('./agent-config', () => ({
  getContextFileNames: vi.fn().mockReturnValue(['CLAUDE.md']),
  getAllKnownContextFileNames: vi.fn().mockReturnValue(['AGENTS.md', 'CLAUDE.md', '.claude.md']),
}));

import { generateClaudeContext, loadClaudeConfig, backfillAgentRules, buildAgentRulesSection, AGENT_RULES_VERSION } from './claude-integration';
import * as fs from 'fs/promises';
import { getContextFileNames } from './agent-config';

describe('loadClaudeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default config when file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const config = await loadClaudeConfig();

    expect(config).toEqual({ autoLaunch: false, generateContext: true });
  });

  it('merges file config with defaults', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ autoLaunch: true }));

    const config = await loadClaudeConfig();

    expect(config).toEqual({ autoLaunch: true, generateContext: true });
  });
});

describe('generateClaudeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Per-repo context files (AGENTS.md / .claude.md inside each repo dir)
    // don't exist in tests — reject all readFile calls by default so
    // buildPerRepoContextSection skips gracefully.
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
  });

  it('writes CLAUDE.md file to workspace path', async () => {
    const repos = [
      { name: 'repo-a', url: 'https://github.com/org/repo-a', sshUrl: 'git@github.com:org/repo-a.git', owner: { login: 'org' }, description: '', isPrivate: false },
      { name: 'repo-b', url: 'https://github.com/org/repo-b', sshUrl: 'git@github.com:org/repo-b.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/test', 'test', repos);

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/test/CLAUDE.md',
      expect.any(String),
      'utf-8'
    );
  });

  it('includes workspace name in the content', async () => {
    const repos = [
      { name: 'my-repo', url: 'https://github.com/org/my-repo', sshUrl: 'git@github.com:org/my-repo.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/my-ws', 'my-ws', repos);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('my-ws');
  });

  it('includes repo names in the content', async () => {
    const repos = [
      { name: 'alpha', url: 'https://github.com/org/alpha', sshUrl: 'git@github.com:org/alpha.git', owner: { login: 'org' }, description: '', isPrivate: false },
      { name: 'beta', url: 'https://github.com/org/beta', sshUrl: 'git@github.com:org/beta.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/test', 'test', repos);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('alpha');
    expect(writtenContent).toContain('beta');
  });

  it('lists both instances when same repo is added with different suffixes', async () => {
    const repos = [
      { name: 'partnerships-api', url: 'https://github.com/acme/partnerships-api', sshUrl: 'git@github.com:acme/partnerships-api.git', owner: { login: 'acme' }, description: 'Partnerships API', isPrivate: false },
    ];
    const metadata = {
      workspaceName: 'test-ws',
      createdAt: '2024-01-01T00:00:00Z',
      repositories: [
        { name: 'partnerships-api', directoryName: 'partnerships-api', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: 'git@github.com:acme/partnerships-api.git', status: 'success' as const },
        { name: 'partnerships-api', directoryName: 'partnerships-api-v2', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: 'git@github.com:acme/partnerships-api.git', status: 'success' as const },
      ],
    };

    await generateClaudeContext('/workspace/test-ws', 'test-ws', repos, metadata);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('partnerships-api/');
    expect(writtenContent).toContain('partnerships-api-v2');
  });

  it('shows correct directory names from metadata, not repo names', async () => {
    const repos = [
      { name: 'my-service', url: 'https://github.com/acme/my-service', sshUrl: 'git@github.com:acme/my-service.git', owner: { login: 'acme' }, description: '', isPrivate: false },
    ];
    const metadata = {
      workspaceName: 'ws',
      createdAt: '2024-01-01T00:00:00Z',
      repositories: [
        { name: 'my-service', directoryName: 'my-service-hotfix', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: 'git@github.com:acme/my-service.git', status: 'success' as const },
      ],
    };

    await generateClaudeContext('/workspace/ws', 'ws', repos, metadata);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('my-service-hotfix');
  });

  it('shows correct count when duplicate repos exist', async () => {
    const repos = [
      { name: 'svc', url: 'https://github.com/acme/svc', sshUrl: 'git@github.com:acme/svc.git', owner: { login: 'acme' }, description: '', isPrivate: false },
    ];
    const metadata = {
      workspaceName: 'ws',
      createdAt: '2024-01-01T00:00:00Z',
      repositories: [
        { name: 'svc', directoryName: 'svc', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: '', status: 'success' as const },
        { name: 'svc', directoryName: 'svc-v2', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: '', status: 'success' as const },
        { name: 'svc', directoryName: 'svc-v3', owner: 'acme', clonedAt: '2024-01-01T00:00:00Z', cloneUrl: '', status: 'failed' as const },
      ],
    };

    await generateClaudeContext('/workspace/ws', 'ws', repos, metadata);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    // Only 2 successful repos should be counted
    expect(writtenContent).toContain('2 repositories');
  });

  it('generates AGENTS.md when Pi is configured', async () => {
    vi.mocked(getContextFileNames).mockReturnValue(['AGENTS.md']);

    const repos = [
      { name: 'repo-a', url: 'https://github.com/org/repo-a', sshUrl: 'git@github.com:org/repo-a.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/test', 'test', repos);

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/test/AGENTS.md',
      expect.any(String),
      'utf-8'
    );
  });

  it('generates both CLAUDE.md and AGENTS.md when both agents configured', async () => {
    vi.mocked(getContextFileNames).mockReturnValue(['CLAUDE.md', 'AGENTS.md']);

    const repos = [
      { name: 'repo-a', url: 'https://github.com/org/repo-a', sshUrl: 'git@github.com:org/repo-a.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/test', 'test', repos);

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const writtenPaths = calls.map(c => c[0]);
    expect(writtenPaths).toContain('/workspace/test/CLAUDE.md');
    expect(writtenPaths).toContain('/workspace/test/AGENTS.md');
  });

  it('uses agent-neutral language in tips section', async () => {
    vi.mocked(getContextFileNames).mockReturnValue(['CLAUDE.md']);

    const repos = [
      { name: 'my-repo', url: 'https://github.com/org/my-repo', sshUrl: 'git@github.com:org/my-repo.git', owner: { login: 'org' }, description: '', isPrivate: false },
    ];

    await generateClaudeContext('/workspace/my-ws', 'my-ws', repos);

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('Tips for Working with AI Agents');
    expect(writtenContent).not.toContain('Tips for Working with Claude');
  });
});

describe('buildPerRepoContextSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no repos have context files', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    // also mock readdir to return empty so recursion stops
    vi.mocked((fs as any).readdir).mockRejectedValue(new Error('ENOENT'));
    const { buildPerRepoContextSection } = await import('./claude-integration');
    const result = await buildPerRepoContextSection('/ws', ['repo-a']);
    expect(result).toBeNull();
  });

  it('uses imperative scoping language and proper markdown (no blockquotes)', async () => {
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      if (String(filePath).endsWith('repo-a/AGENTS.md')) {
        return '# Repo A\n\n## Architecture\n\nUse fastify.\n\n```bash\n# build it\nnpm run build\n```\n';
      }
      throw new Error('ENOENT');
    });
    vi.mocked((fs as any).readdir).mockRejectedValue(new Error('ENOENT'));

    const { buildPerRepoContextSection } = await import('./claude-integration');
    const result = await buildPerRepoContextSection('/ws', ['repo-a']);

    expect(result).not.toBeNull();
    // Imperative scoping at the top
    expect(result).toContain('AUTHORITATIVE for that repo');
    // Per-repo subsection has clear scoping directive
    expect(result).toContain('You MUST follow these rules');
    // No blockquote prefix on any embedded line
    expect(result).not.toMatch(/^>\s/m);
    // Headings demoted by 3 levels (#  -> ####, ## -> #####)
    expect(result).toContain('#### Repo A');
    expect(result).toContain('##### Architecture');
    // Code-block contents NOT demoted (shell comment stays as one #)
    expect(result).toContain('# build it');
    expect(result).not.toContain('#### build it');
  });
});

describe('backfillAgentRules — versioned replace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embeds the current version marker and the new "current workspace only" rule', () => {
    const block = buildAgentRulesSection('demo');
    expect(block).toContain(`<!-- ws-rules:v${AGENT_RULES_VERSION} -->`);
    expect(block).toContain('ONLY read code from repos in THIS workspace');
  });

  it('replaces a stale pre-versioning rules block in place (no duplicate heading)', async () => {
    const staleFile = [
      '# Workspace: demo',
      '',
      '## AI Agent Rules',
      '',
      '**NEVER** use `git clone` directly to add repositories to this workspace.',
      '',
      '## Tips for Working with AI Agents',
      '',
      'be nice',
      '',
    ].join('\n');
    vi.mocked(fs.readFile).mockResolvedValue(staleFile);

    const updated = await backfillAgentRules('/ws/demo', 'demo');

    expect(updated).toBeGreaterThan(0);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect((written.match(/## AI Agent Rules/g) || []).length).toBe(1);
    expect(written).toContain(`<!-- ws-rules:v${AGENT_RULES_VERSION} -->`);
    expect(written).toContain('ONLY read code from repos in THIS workspace');
    expect(written).toContain('## Tips for Working with AI Agents'); // following section preserved
  });

  it('is idempotent when the block is already at the current version', async () => {
    const current = `# Workspace: demo\n\n${buildAgentRulesSection('demo')}## Notes\n\n- x\n`;
    vi.mocked(fs.readFile).mockResolvedValue(current);

    const updated = await backfillAgentRules('/ws/demo', 'demo');

    expect(updated).toBe(0);
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
  });

  it('replaces a stale block in CRLF (\\r\\n) files too', async () => {
    const staleCrlf = [
      '# Workspace: demo',
      '',
      '## AI Agent Rules',
      '',
      '**NEVER** use `git clone` directly.',
      '',
      '## Tips for Working with AI Agents',
      '',
      'be nice',
      '',
    ].join('\r\n');
    vi.mocked(fs.readFile).mockResolvedValue(staleCrlf);

    const updated = await backfillAgentRules('/ws/demo', 'demo');

    expect(updated).toBeGreaterThan(0);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect((written.match(/## AI Agent Rules/g) || []).length).toBe(1);
    expect(written).toContain(`<!-- ws-rules:v${AGENT_RULES_VERSION} -->`);
    expect(written).toContain('ONLY read code from repos in THIS workspace');
    expect(written).toContain('## Tips for Working with AI Agents');
  });

  it('inserts the section when missing, before Notes', async () => {
    const noRules = '# Workspace: x\n\n## Notes\n\n- hi\n';
    vi.mocked(fs.readFile).mockResolvedValue(noRules);

    const updated = await backfillAgentRules('/ws/x', 'x');

    expect(updated).toBeGreaterThan(0);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written.indexOf('## AI Agent Rules')).toBeLessThan(written.indexOf('## Notes'));
    expect(written).toContain('ONLY read code from repos in THIS workspace');
  });
});
