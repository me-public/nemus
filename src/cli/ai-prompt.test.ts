import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const {
  mockExec,
  mockExecFileSync,
  mockSpawn,
  mockMkdirSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

vi.mock('fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../utils/config', () => ({
  WORKSPACES_DIR: '/test-workspaces',
}));

vi.mock('../utils/agent-config', () => ({
  getPrimaryAgent: vi.fn().mockReturnValue({
    type: 'claude',
    launchCommand: 'claude',
    resumeCommand: (id: string) => `claude --resume ${id} --fork-session`,
    supportsMcp: true,
    supportsHooks: true,
  }),
  isAgentCliAvailable: vi.fn().mockReturnValue(true),
}));

vi.mock('../utils/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logStep: vi.fn(),
}));

vi.mock('../utils/colors', () => ({
  colorize: (text: string) => text,
}));

import { main, run, buildExtractionPrompt, isClaudeAvailable, extractIntent, AI_PROMPT_FILE } from './ai-prompt';
import { logInfo, logError } from '../utils/logger';

function setupSpawnMock(exitCode: number = 0) {
  const handlers: Record<string, Function> = {};
  const child = {
    on: vi.fn((event: string, cb: Function) => {
      handlers[event] = cb;
      if (event === 'exit') {
        process.nextTick(() => cb(exitCode));
      }
    }),
  };
  mockSpawn.mockReturnValue(child);
  return { child, handlers };
}

function setupExecMock(success: boolean) {
  mockExec.mockImplementation((_cmd: string, cb: Function) => {
    if (success) {
      cb(null, { stdout: '/usr/local/bin/claude\n', stderr: '' });
    } else {
      cb(new Error('not found'), { stdout: '', stderr: '' });
    }
  });
}

function setupExtractMock(intent: { workspaceName: string; repos: string[]; remainingIntent: string }) {
  mockExecFileSync.mockReturnValue(JSON.stringify({
    type: 'result',
    result: '',
    structured_output: intent,
  }));
}

describe('buildExtractionPrompt', () => {
  it('includes the user prompt', () => {
    const prompt = buildExtractionPrompt('create payments workspace');
    expect(prompt).toContain('create payments workspace');
  });

  it('asks for workspace name and repo names', () => {
    const prompt = buildExtractionPrompt('test');
    expect(prompt).toContain('workspace name');
    expect(prompt).toContain('repository names');
  });
});

describe('extractIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses structured output from Claude', async () => {
    setupExtractMock({
      workspaceName: 'payments',
      repos: ['acme-app', 'partnerships-api'],
      remainingIntent: 'set up feature branch',
    });

    const result = await extractIntent('create payments workspace with acme-app and partnerships-api then set up feature branch');

    expect(result.workspaceName).toBe('payments');
    expect(result.repos).toEqual(['acme-app', 'partnerships-api']);
    expect(result.remainingIntent).toBe('set up feature branch');
  });

  it('throws an actionable error (not cryptic ETIMEDOUT) when the agent times out', async () => {
    const timeoutErr: any = new Error('spawnSync pi ETIMEDOUT');
    timeoutErr.code = 'ETIMEDOUT';
    timeoutErr.killed = true;
    mockExecFileSync.mockImplementation(() => { throw timeoutErr; });

    await expect(extractIntent('create test workspace')).rejects.toThrow(/did not respond within \d+s/);
    // Should include actionable guidance, not just ETIMEDOUT
    await expect(extractIntent('create test workspace')).rejects.toThrow(/w create --workspace/);
  });

  it('surfaces agent stderr on a non-timeout failure', async () => {
    const failErr: any = new Error('Command failed');
    failErr.stderr = 'Bedrock: AccessDeniedException — token expired';
    mockExecFileSync.mockImplementation(() => { throw failErr; });

    await expect(extractIntent('create test workspace')).rejects.toThrow(/token expired/);
  });

  it('does not mislabel a maxBuffer overflow (killed=true, ENOBUFS) as a timeout', async () => {
    const bufErr: any = new Error('stdout maxBuffer length exceeded');
    bufErr.code = 'ENOBUFS';
    bufErr.killed = true; // execFileSync sets killed on maxBuffer too
    mockExecFileSync.mockImplementation(() => { throw bufErr; });

    // Should NOT say "did not respond within" (that's the timeout message)
    await expect(extractIntent('create test workspace')).rejects.toThrow(/maxBuffer exceeded/);
    await expect(extractIntent('create test workspace')).rejects.not.toThrow(/did not respond within/);
  });

  it('falls back to parsing result string when structured_output is absent', async () => {
    const intent = { workspaceName: 'test', repos: ['repo1'], remainingIntent: '' };
    mockExecFileSync.mockReturnValue(JSON.stringify({
      type: 'result',
      result: JSON.stringify(intent),
    }));

    const result = await extractIntent('create test workspace');

    expect(result.workspaceName).toBe('test');
    expect(result.repos).toEqual(['repo1']);
  });

  it('calls claude lean (bare + strict-mcp + no-skills) with -p and --json-schema', async () => {
    setupExtractMock({ workspaceName: 'test', repos: ['repo1'], remainingIntent: '' });

    await extractIntent('create test workspace');

    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('-p');
    expect(args.some((a) => a.includes('create test workspace'))).toBe(true);
    expect(args).toContain('--output-format');
    expect(args).toContain('--json-schema');
    // Lean flags so a heavy ~/.claude can't time out the extraction
    for (const flag of ['--bare', '--strict-mcp-config', '--disable-slash-commands']) {
      expect(args).toContain(flag);
    }
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ encoding: 'utf-8', timeout: 120_000 }),
    );
  });

  it('falls back to plain `claude -p` when the lean flags are rejected', async () => {
    // First call (lean/preferred) fails instantly as if --bare is unknown;
    // second call (plain fallback) returns raw JSON text.
    const unknownFlag: any = new Error("error: unknown option '--bare'");
    unknownFlag.stderr = "error: unknown option '--bare'";
    let call = 0;
    mockExecFileSync.mockImplementation(() => {
      call++;
      if (call === 1) throw unknownFlag;
      return JSON.stringify({ workspaceName: 'test', repos: ['repo1'], remainingIntent: '' });
    });

    const result = await extractIntent('create test workspace');

    expect(call).toBe(2); // retried
    expect(result.workspaceName).toBe('test');
    expect(result.repos).toEqual(['repo1']);
    // First attempt had the lean flags; the retry (fallback) did not.
    const firstArgs = mockExecFileSync.mock.calls[0][1] as string[];
    const secondArgs = mockExecFileSync.mock.calls[1][1] as string[];
    expect(firstArgs).toContain('--bare');
    expect(secondArgs).not.toContain('--bare');
    expect(secondArgs).not.toContain('--json-schema');
    expect(secondArgs).toContain('-p');
  });

  it('does NOT retry the fallback on a timeout (only on fast failures)', async () => {
    const timeoutErr: any = new Error('spawnSync claude ETIMEDOUT');
    timeoutErr.code = 'ETIMEDOUT';
    let call = 0;
    mockExecFileSync.mockImplementation(() => { call++; throw timeoutErr; });

    await expect(extractIntent('create test workspace')).rejects.toThrow(/did not respond within/);
    expect(call).toBe(1); // no fallback retry on timeout
  });

  describe('Pi agent', () => {
    let getPrimaryAgentMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const agentConfig = await import('../utils/agent-config');
      getPrimaryAgentMock = vi.mocked(agentConfig.getPrimaryAgent);
      getPrimaryAgentMock.mockReturnValue({
        type: 'pi',
        launchCommand: 'pi',
        resumeCommand: (id: string) => `pi --session ${id} --fork`,
        supportsMcp: false,
        supportsHooks: false,
      });
    });

    afterEach(() => {
      getPrimaryAgentMock.mockReturnValue({
        type: 'claude',
        launchCommand: 'claude',
        resumeCommand: (id: string) => `claude --resume ${id} --fork-session`,
        supportsMcp: true,
        supportsHooks: true,
      });
    });

    it('calls pi lean (no extensions/skills/tools/context) with -p, no --mode json', async () => {
      const intent = { workspaceName: 'rigs', repos: ['agentic-coding-rigs'], remainingIntent: '' };
      mockExecFileSync.mockReturnValue(JSON.stringify(intent));

      await extractIntent('create rigs workspace');

      const args = mockExecFileSync.mock.calls[0][1] as string[];
      // -p with the prompt is still present
      expect(args).toContain('-p');
      expect(args.some((a) => a.includes('create rigs workspace'))).toBe(true);
      // Lean flags must be present so a bloated pi setup can't time out
      for (const flag of ['--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-tools', '--no-session']) {
        expect(args).toContain(flag);
      }
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'pi',
        expect.any(Array),
        expect.objectContaining({ encoding: 'utf-8', timeout: 120_000 }),
      );
      // Should NOT include --mode json
      expect(args).not.toContain('--mode');
      expect(args).not.toContain('json');
    });

    it('parses Pi raw JSON output directly', async () => {
      const intent = { workspaceName: 'rigs', repos: ['agentic-coding-rigs'], remainingIntent: 'read the readme' };
      mockExecFileSync.mockReturnValue(JSON.stringify(intent));

      const result = await extractIntent('create rigs workspace');

      expect(result.workspaceName).toBe('rigs');
      expect(result.repos).toEqual(['agentic-coding-rigs']);
      expect(result.remainingIntent).toBe('read the readme');
    });

    it('strips markdown code fences from Pi response', async () => {
      const intent = { workspaceName: 'rigs', repos: ['agentic-coding-rigs'], remainingIntent: '' };
      mockExecFileSync.mockReturnValue('```json\n' + JSON.stringify(intent) + '\n```');

      const result = await extractIntent('create rigs workspace');

      expect(result.workspaceName).toBe('rigs');
      expect(result.repos).toEqual(['agentic-coding-rigs']);
    });

    it('strips code fences without language tag', async () => {
      const intent = { workspaceName: 'test', repos: ['repo1'], remainingIntent: '' };
      mockExecFileSync.mockReturnValue('```\n' + JSON.stringify(intent) + '\n```');

      const result = await extractIntent('create test workspace');

      expect(result.workspaceName).toBe('test');
    });

    it('handles Pi output with extra whitespace', async () => {
      const intent = { workspaceName: 'test', repos: ['repo1'], remainingIntent: '' };
      mockExecFileSync.mockReturnValue('\n\n' + JSON.stringify(intent) + '\n\n');

      const result = await extractIntent('create test workspace');

      expect(result.workspaceName).toBe('test');
    });
  });
});

describe('isClaudeAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when claude CLI is found', async () => {
    setupExecMock(true);
    const result = await isClaudeAvailable();
    expect(result).toBe(true);
  });

  it('returns false when claude CLI is not found', async () => {
    setupExecMock(false);
    const result = await isClaudeAvailable();
    expect(result).toBe(false);
  });
});

describe('run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 1 when claude CLI is not available', async () => {
    setupExecMock(false);

    const exitCode = await run('create a workspace');

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('CLI not found'));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('extracts intent then spawns w create with correct flags', async () => {
    setupExecMock(true);
    setupExtractMock({
      workspaceName: 'payments',
      repos: ['acme-app', 'partnerships-api'],
      remainingIntent: '',
    });
    setupSpawnMock(0);

    await run('create payments workspace with acme-app and partnerships-api');

    expect(mockSpawn).toHaveBeenCalledWith(
      'w',
      ['create', '--workspace', 'payments', '--repos', 'acme-app,partnerships-api', '--prompt', 'create payments workspace with acme-app and partnerships-api', '--yes'],
      { stdio: 'inherit' },
    );
  });

  it('ensures WORKSPACES_DIR exists before extracting intent', async () => {
    setupExecMock(true);
    setupExtractMock({ workspaceName: 'test', repos: ['repo'], remainingIntent: '' });
    setupSpawnMock(0);

    await run('create test workspace');

    expect(mockMkdirSync).toHaveBeenCalledWith('/test-workspaces', { recursive: true });
  });

  it('returns 1 when intent extraction fails', async () => {
    setupExecMock(true);
    mockExecFileSync.mockImplementation(() => { throw new Error('timeout'); });

    const exitCode = await run('create workspace');

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith('Failed to parse workspace request');
  });

  it('returns 1 when no repos extracted', async () => {
    setupExecMock(true);
    setupExtractMock({ workspaceName: 'test', repos: [], remainingIntent: '' });

    const exitCode = await run('create empty workspace');

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith('Could not determine workspace name or repos from prompt');
  });

  it('returns 1 when repos is null or missing', async () => {
    setupExecMock(true);
    mockExecFileSync.mockReturnValue(JSON.stringify({
      type: 'result',
      result: '',
      structured_output: { workspaceName: 'test', repos: null, remainingIntent: '' },
    }));

    const exitCode = await run('create test workspace');

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledWith('Could not determine workspace name or repos from prompt');
  });

  it('saves remaining intent to AI_PROMPT_FILE', async () => {
    setupExecMock(true);
    setupExtractMock({
      workspaceName: 'payments',
      repos: ['acme-app'],
      remainingIntent: 'fix the login bug',
    });
    setupSpawnMock(0);

    await run('create payments workspace with acme-app and fix the login bug');

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      AI_PROMPT_FILE,
      'fix the login bug',
      'utf-8',
    );
  });

  it('saves full prompt as remaining intent when remainingIntent is empty', async () => {
    setupExecMock(true);
    setupExtractMock({
      workspaceName: 'payments',
      repos: ['acme-app'],
      remainingIntent: '',
    });
    setupSpawnMock(0);

    await run('create payments workspace with acme-app');

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      AI_PROMPT_FILE,
      'create payments workspace with acme-app',
      'utf-8',
    );
  });

  it('propagates non-zero exit code from w create', async () => {
    setupExecMock(true);
    setupExtractMock({ workspaceName: 'test', repos: ['repo'], remainingIntent: '' });
    setupSpawnMock(1);

    const exitCode = await run('create test workspace');

    expect(exitCode).toBe(1);
  });

  it('truncates long prompts in log output', async () => {
    const longPrompt = 'a'.repeat(100);
    setupExecMock(true);
    setupExtractMock({ workspaceName: 'test', repos: ['repo'], remainingIntent: '' });
    setupSpawnMock(0);

    await run(longPrompt);

    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('...'));
  });
});

describe('main', () => {
  const originalArgv = process.argv;
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'ai-prompt.js'];
    mockExit.mockClear();
  });

  afterAll(() => {
    process.argv = originalArgv;
    mockExit.mockRestore();
  });

  it('exits with error when no prompt is provided', async () => {
    process.argv = ['node', 'ai-prompt.js'];

    await main();

    expect(logError).toHaveBeenCalledWith('No prompt provided');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('exits with error when prompt is empty string', async () => {
    process.argv = ['node', 'ai-prompt.js', ''];

    await main();

    expect(logError).toHaveBeenCalledWith('No prompt provided');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits with error when prompt is whitespace only', async () => {
    process.argv = ['node', 'ai-prompt.js', '   '];

    await main();

    expect(logError).toHaveBeenCalledWith('No prompt provided');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('joins multiple argv words into a single prompt', async () => {
    process.argv = ['node', 'ai-prompt.js', 'create', 'a', 'workspace'];
    setupExecMock(true);
    setupExtractMock({ workspaceName: 'workspace', repos: ['some-repo'], remainingIntent: '' });
    setupSpawnMock(0);

    await main();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', expect.stringContaining('create a workspace')]),
      expect.any(Object),
    );
  });
});
