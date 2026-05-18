import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/shared/types.js';
import { CliProcessPool } from '../src/daemon/cli-pool.js';

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
});

function createConfig(): Config {
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
    geminiPath: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite-preview',
    geminiTimeoutMs: 5_000,
    geminiMaxConcurrent: 3,
    conversationHistoryLength: 10,
    promptHistoryMessageLimit: 16,
    promptHistoryCharBudget: 12000,
    streaming: true,
    queueMaxDepth: 10,
    enableDMs: true,
    requireMention: false,
    respondToReplies: true,
    memoryScope: 'global',
    autoStartDaemon: true,
    useGeminiCliSessions: true,
    geminiSessionBindingScope: 'global',
    cliIdleTimeoutMs: 300000,
    setupValidationPending: false,
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
  };
}
