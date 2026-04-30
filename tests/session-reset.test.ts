import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetConversationSession } from '../src/daemon/session-reset.js';
import { runtimeStore } from '../src/daemon/runtime.js';
import { loadGeminiBindingState } from '../src/daemon/binding.js';
import { resolveDmPairingKey } from '../src/daemon/dm-pairing.js';
import type { Config } from '../src/shared/types.js';

let tmpDir: string;

describe('resetConversationSession', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-reset-'));
    runtimeStore.cliPool = {
      kill: vi.fn(),
    } as any;
  });

  afterEach(() => {
    runtimeStore.cliPool = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });


  it('clears memory and resets the paired DM Gemini session for the user', () => {
    const memory = {
      archiveAndReset: vi.fn(),
    } as any;

    const config = createConfig();
    const result = resetConversationSession(config, memory, tmpDir, {
      channelId: 'dm-channel-1',
      guildId: null,
      authorId: 'owner-1',
    });

    expect(result.sessionKey).toBe('dm:owner-1');
    expect(result.bindingKey).toBe(resolveDmPairingKey('owner-1'));
    expect(memory.archiveAndReset).toHaveBeenCalledWith('dm:owner-1', {
      bindingKey: resolveDmPairingKey('owner-1'),
      lastSessionId: undefined,
    });
    expect((runtimeStore.cliPool as any).kill).toHaveBeenCalledWith(resolveDmPairingKey('owner-1'));
  });

  it('clears memory and resets the bound Gemini session for the channel', () => {
    const memory = {
      archiveAndReset: vi.fn(),
    } as any;

    const config = createConfig();
    const result = resetConversationSession(config, memory, tmpDir, {
      channelId: 'c1',
      guildId: 'g1',
    });

    expect(result.sessionKey).toBe('channel:c1');
    expect(result.bindingKey).toBe('channel:c1');
    expect(memory.archiveAndReset).toHaveBeenCalledWith('channel:c1', {
      bindingKey: 'channel:c1',
      lastSessionId: undefined,
    });
    expect((runtimeStore.cliPool as any).kill).toHaveBeenCalledWith('channel:c1');

    const bindingDir = path.join(tmpDir, '.gemini-discord', 'bindings', 'channel-c1');
    expect(loadGeminiBindingState(bindingDir)).toMatchObject({
      hasSession: false,
      archivedSessionIds: [],
    });
    expect(loadGeminiBindingState(bindingDir).lastResetAt).toEqual(expect.any(String));
  });
});

function createConfig(): Config {
  return {
    discordBotToken: '',
    discordChannelId: '',
    discordServerId: '',
    discordServerName: '',
    ownerIds: [],
    discordAdminId: '',
    allowedChannelIds: [],
    allowedUserIds: [],
    allowedAgentIds: [],
    daemonApiToken: '',
    discordPrefix: '!',
    discordResetCmd: '!reset',
    daemonPort: 0,
    geminiPath: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite-preview',
    geminiTimeoutMs: 0,
    geminiMaxConcurrent: 1,
    conversationHistoryLength: 1,
    promptHistoryMessageLimit: 1,
    promptHistoryCharBudget: 1,
    streaming: true,
    queueMaxDepth: 1,
    enableDMs: true,
    requireMention: true,
    respondToReplies: true,
    memoryScope: 'channel',
    autoStartDaemon: true,
    useGeminiCliSessions: true,
    geminiSessionBindingScope: 'channel',
    cliIdleTimeoutMs: 1,
  };
}
