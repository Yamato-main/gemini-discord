import { describe, it, expect } from 'vitest';
import type { Config } from '../src/shared/types.js';
import { shouldAcceptMessage } from '../src/daemon/routing.js';

const baseConfig: Config = {
  discordBotToken: 'token',
  discordChannelId: 'ch1',
  ownerIds: ['owner1'],
  discordBossId: 'owner1',
  allowedChannelIds: ['ch1', 'ch2'],
  allowedUserIds: ['owner1', 'user2'],
  allowedAgentIds: ['agent1'],
  daemonApiToken: 'x'.repeat(64),
  peerAgentId: 'peer-agent',
  reportingChannelId: 'reporting-channel',
  discordPrefix: '!',
  discordResetCmd: '!reset',
  daemonPort: 18790,
  geminiPath: 'gemini',
  geminiModel: 'gemini-3.1-pro-preview',
  geminiTimeoutMs: 300000,
  geminiMaxConcurrent: 3,
  conversationHistoryLength: 10,
  promptHistoryMessageLimit: 16,
  promptHistoryCharBudget: 12000,
  streaming: true,
  queueMaxDepth: 20,
  enableDMs: true,
  requireMention: false,
  respondToReplies: true,
  memoryScope: 'global',
  autoStartDaemon: true,
  useGeminiCliSessions: true,
  geminiSessionBindingScope: 'server',
  cliIdleTimeoutMs: 300000,
  autonomous: {
    enabled: false,
    intervalMs: 300000,
    targetChannelId: '',
    targetChannelName: '',
    assumeMasterAway: true,
    fourChan: {
      enabled: false,
      board: 'a',
      keywords: [],
      minSignal: 3,
      cooldownMs: 3600000,
      signalWindowMs: 1800000,
      timelineLimit: 200,
    },
  },
};

function route(overrides: Partial<Parameters<typeof shouldAcceptMessage>[0]> = {}, config: Config = baseConfig) {
  return shouldAcceptMessage({
    authorId: 'owner1',
    authorTag: 'User#0001',
    isBot: false,
    botUserId: 'bot1',
    content: 'hello',
    attachmentCount: 0,
    channelId: 'ch1',
    channelName: 'bot-channel',
    guildId: 'g1',
    guildName: 'Sanctum',
    isDM: false,
    mentionedBot: false,
    repliedToBot: false,
    replyToMessageId: null,
    ...overrides,
  }, config);
}

describe('shouldAcceptMessage', () => {
  it('accepts allowlisted human messages in allowed channels', () => {
    expect(route()).toMatchObject({
      accept: true,
      speakerKind: 'human',
      trigger: 'channel',
      content: 'hello',
    });
  });

  it('strips command prefixes', () => {
    expect(route({ content: '!hello there' })).toMatchObject({
      accept: true,
      trigger: 'prefix',
      content: 'hello there',
    });
  });

  it('rejects humans outside the allowlist', () => {
    expect(route({ authorId: 'stranger' })).toMatchObject({ accept: false });
  });

  it('requires explicit triggers for peer agents', () => {
    expect(route({
      authorId: 'agent1',
      authorTag: 'OtherAgent#9999',
      isBot: true,
      content: 'hello',
    })).toMatchObject({ accept: false });

    expect(route({
      authorId: 'agent1',
      authorTag: 'OtherAgent#9999',
      isBot: true,
      content: '<@bot1> hello',
      mentionedBot: true,
    })).toMatchObject({
      accept: true,
      speakerKind: 'agent',
      trigger: 'mention',
      content: 'hello',
    });
  });

  it('supports DMs for allowlisted humans', () => {
    expect(route({
      isDM: true,
      guildId: null,
      guildName: null,
      channelId: 'dm1',
      channelName: 'dm-user',
      content: 'private hello',
    })).toMatchObject({
      accept: true,
      trigger: 'dm',
      content: 'private hello',
    });
  });

  it('accepts image-only messages', () => {
    expect(route({ content: '', attachmentCount: 1 })).toMatchObject({
      accept: true,
      content: '',
      trigger: 'channel',
    });
  });

  it('honors requireMention in guild channels', () => {
    const config: Config = { ...baseConfig, requireMention: true };
    expect(route({}, config)).toMatchObject({ accept: false });
    expect(route({ mentionedBot: true, content: '<@bot1> hello' }, config)).toMatchObject({
      accept: true,
      trigger: 'mention',
      content: 'hello',
    });
  });
});
