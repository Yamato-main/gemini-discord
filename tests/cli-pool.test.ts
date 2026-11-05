import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/shared/types.js';
import type { RoleContext } from '../src/daemon/permissions.js';
import {
  buildDiscordBridgeAcpMcpServer,
  buildGeminiAcpArgs,
  buildGeminiProcessEnv,
  CliProcessPool,
} from '../src/daemon/cli-pool.js';

describe('CliProcessPool', () => {
  it('retries once after a Gemini ACP code 1 crash before any assistant output', async () => {
    const pool = new CliProcessPool(createConfig());
    const spawnProcess = vi.fn()
      .mockResolvedValueOnce(createEntry('pool-1'))
      .mockResolvedValueOnce(createEntry('pool-2'));
    const ensureSession = vi.fn().mockResolvedValue(undefined);
    const promptWithAcp = vi.fn()
      .mockRejectedValueOnce(new Error('Gemini ACP exited with code 1. stack trace'))
      .mockResolvedValueOnce('all clear');

    (pool as unknown as {
      spawnProcess: typeof spawnProcess;
      ensureSession: typeof ensureSession;
      promptWithAcp: typeof promptWithAcp;
      evict: (poolKey: string) => void;
    }).spawnProcess = spawnProcess;
    (pool as unknown as {
      spawnProcess: typeof spawnProcess;
      ensureSession: typeof ensureSession;
      promptWithAcp: typeof promptWithAcp;
      evict: (poolKey: string) => void;
    }).ensureSession = ensureSession;
    (pool as unknown as {
      spawnProcess: typeof spawnProcess;
      ensureSession: typeof ensureSession;
      promptWithAcp: typeof promptWithAcp;
      evict: (poolKey: string) => void;
    }).promptWithAcp = promptWithAcp;

    const result = await pool.send(
      'binding-1',
      'hello there',
      { onToken: vi.fn() },
      {
        cwd: '/tmp/project',
        roleContext: {
          role: 'GUEST',
          senderDiscordId: '222222222222222222',
          senderDisplayLabel: 'Guest#0001',
          bossLabel: 'the boss',
          bossConfigValid: true,
        },
        toolMode: 'chat',
      },
    );

    expect(result).toBe('all clear');
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(promptWithAcp).toHaveBeenCalledTimes(2);
  });

  it('prevents deletion of a new process by an old closing process', () => {
    const pool = new CliProcessPool(createConfig());
    const entry1 = createEntry('key-1') as any;
    const entry2 = createEntry('key-1') as any;

    // Register entry2 (the new process) under key-1
    pool['pool'].set('key-1', entry2);

    // Simulate entry1 close handler running
    const closeHandler = (entry: any) => {
      if (pool['pool'].get(entry.poolKey) === entry) {
        pool['pool'].delete(entry.poolKey);
      }
    };

    closeHandler(entry1);

    // key-1 should still point to entry2
    expect(pool['pool'].get('key-1')).toBe(entry2);

    // Simulate entry2 close handler running
    closeHandler(entry2);

    // key-1 should now be deleted
    expect(pool['pool'].get('key-1')).toBeUndefined();
  });

  it('passes configured Gemini auth env to spawned CLI processes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cli-env-'));
    try {
      const config = createConfig({
        extensionDir: tmpDir,
        headlessGeminiCliHome: path.join(tmpDir, '.gemini-discord', 'gemini-cli'),
        headlessGeminiCliSettingsFile: path.join(tmpDir, '.gemini-discord', 'gemini-cli', 'settings.json'),
        geminiCliEnv: {
          GEMINI_API_KEY: 'configured-api-key',
          GOOGLE_GENAI_USE_VERTEXAI: 'true',
        },
      });

      const env = buildGeminiProcessEnv(config, createRoleContext(), { GEMINI_API_KEY: 'process-api-key' });

      expect(env.GEMINI_API_KEY).toBe('configured-api-key');
      expect(env.GOOGLE_GENAI_USE_VERTEXAI).toBe('true');
      expect(env.GEMINI_DISCORD_ROLE).toBe('GUEST');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('isolates headless Gemini CLI processes in a generated CLI home', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cli-home-'));
    try {
      const config = createConfig({
        extensionDir: tmpDir,
        headlessGeminiCliHome: path.join(tmpDir, '.gemini-discord', 'gemini-cli'),
        headlessGeminiCliSettingsFile: path.join(tmpDir, '.gemini-discord', 'gemini-cli', 'settings.json'),
        geminiCliEnv: {
          GEMINI_API_KEY: 'configured-api-key',
        },
      });

      const env = buildGeminiProcessEnv(config, createRoleContext(), {});
      const settings = JSON.parse(fs.readFileSync(config.headlessGeminiCliSettingsFile, 'utf-8'));

      expect(env.GEMINI_CLI_HOME).toBe(config.headlessGeminiCliHome);
      expect(settings.security.auth.selectedType).toBe('gemini-api-key');
      expect(settings.admin.extensions.enabled).toBe(false);
      expect(settings.extensions.disabled).toContain('gemini-discord');
      expect(settings.mcp.allowed).toEqual(['discord-bridge']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses allowed MCP server names without loading the gemini-discord extension', () => {
    const args = buildGeminiAcpArgs(createConfig({ geminiModel: 'auto' }), 'none');

    expect(args).toContain('--allowed-mcp-server-names');
    expect(args).toContain('discord-bridge');
    expect(args).not.toContain('--extensions');
    expect(args).not.toContain('gemini-discord');
  });

  it('splits comma-separated allowedTools into individual --allowed-tools CLI parameters', () => {
    const args = buildGeminiAcpArgs(createConfig({ geminiModel: 'auto' }), 'google_web_search,discord_fetch_web_page');

    const allowedIndices = args.reduce<number[]>((acc, item, idx) => {
      if (item === '--allowed-tools') acc.push(idx);
      return acc;
    }, []);

    expect(allowedIndices).toHaveLength(2);
    expect(args[allowedIndices[0] + 1]).toBe('google_web_search');
    expect(args[allowedIndices[1] + 1]).toBe('discord_fetch_web_page');
  });

  it('builds an explicit ACP descriptor for the Discord bridge MCP server with role environment', () => {
    const config = createConfig({ extensionDir: path.join(path.sep, 'extension') });
    const roleContext = createRoleContext();

    expect(buildDiscordBridgeAcpMcpServer(config, roleContext)).toEqual({
      name: 'discord-bridge',
      command: process.execPath,
      args: [path.join(path.sep, 'extension', 'dist', 'server.cjs')],
      env: [
        { name: 'GEMINI_DISCORD_ROLE', value: 'GUEST' },
        { name: 'GEMINI_DISCORD_SENDER_ID', value: '222222222222222222' },
        { name: 'GEMINI_DISCORD_SENDER_LABEL', value: 'Guest#0001' },
      ],
    });
  });

  it('includes the Discord bridge MCP descriptor with roleContext when starting a new ACP session', async () => {
    const pool = new CliProcessPool(createConfig({ extensionDir: path.join(path.sep, 'extension') }));
    const entry = createEntry('key-1') as any;
    const sendRequest = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    const roleContext = createRoleContext();

    (pool as any).sendRequest = sendRequest;

    await (pool as any).ensureSession(entry, {
      cwd: '/tmp/project',
      roleContext,
      toolMode: 'chat',
    });

    expect(sendRequest).toHaveBeenCalledWith(
      entry,
      'session/new',
      {
        cwd: '/tmp/project',
        mcpServers: [buildDiscordBridgeAcpMcpServer(createConfig({ extensionDir: path.join(path.sep, 'extension') }), roleContext)],
      },
      expect.any(Number),
    );
  });

  it('includes the Discord bridge MCP descriptor with roleContext when loading an ACP session', async () => {
    const pool = new CliProcessPool(createConfig({ extensionDir: path.join(path.sep, 'extension') }));
    const entry = createEntry('key-1') as any;
    const sendRequest = vi.fn().mockResolvedValue({});
    const roleContext = createRoleContext();

    (pool as any).sendRequest = sendRequest;
    (pool as any).waitForSessionReplayToDrain = vi.fn().mockResolvedValue(undefined);

    await (pool as any).ensureSession(entry, {
      cwd: '/tmp/project',
      resumeSessionId: 'session-1',
      roleContext,
      toolMode: 'chat',
    });

    expect(sendRequest).toHaveBeenCalledWith(
      entry,
      'session/load',
      {
        sessionId: 'session-1',
        cwd: '/tmp/project',
        mcpServers: [buildDiscordBridgeAcpMcpServer(createConfig({ extensionDir: path.join(path.sep, 'extension') }), roleContext)],
      },
      expect.any(Number),
    );
  });
});

function createRoleContext(): RoleContext {
  return {
    role: 'GUEST',
    senderDiscordId: '222222222222222222',
    senderDisplayLabel: 'Guest#0001',
    bossLabel: 'the boss',
    bossConfigValid: true,
  };
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    discordBotToken: 'test-token',
    discordChannelId: 'channel-1',
    discordServerId: '',
    discordServerName: '',
    discordBossUserId: '111111111111111111',
    ownerIds: ['owner-1'],
    discordAdminId: 'owner-1',
    allowedChannelIds: ['channel-1'],
    allowedUserIds: ['owner-1'],
    allowedAgentIds: [],
    daemonApiToken: 'daemon-token',
    discordPrefix: '!',
    discordResetCmd: '!reset',
    daemonPort: 18790,
    extensionDir: path.join(path.sep, 'extension'),
    geminiPath: 'gemini',
    geminiModel: 'auto',
    geminiTimeoutMs: 5_000,
    geminiMaxConcurrent: 3,
    headlessGeminiCliHome: path.join(path.sep, 'extension', '.gemini-discord', 'gemini-cli'),
    headlessGeminiCliSettingsFile: path.join(path.sep, 'extension', '.gemini-discord', 'gemini-cli', 'settings.json'),
    conversationHistoryLength: 10,
    promptHistoryMessageLimit: 16,
    promptHistoryCharBudget: 12000,
    streaming: true,
    queueMaxDepth: 20,
    enableDMs: true,
    enableGuests: false,
    enableGuestAttachments: false,
    requireMention: false,
    respondToReplies: true,
    memoryScope: 'global',
    autoStartDaemon: true,
    useGeminiCliSessions: true,
    geminiSessionBindingScope: 'global',
    cliIdleTimeoutMs: 300000,
    setupValidationPending: false,
    workflowParentChannelId: '',
    ...overrides,
  };
}

function createEntry(poolKey: string) {
  return {
    proc: {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
    },
    poolKey,
    rl: {
      close: vi.fn(),
    },
    busy: false,
    spawnedAt: Date.now(),
    lastActivityAt: Date.now(),
    idleTimer: null,
    allowedTools: 'none',
    initialized: true,
    nextRequestId: 1,
    pendingRequests: new Map(),
    activePrompt: null,
    sessionId: null,
    cwd: null,
    stderrTail: '',
    lastSessionUpdateAt: 0,
    activeToolTimers: new Map(),
  };
}
