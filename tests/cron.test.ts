import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Client } from 'discord.js';
import { initCron, listJobs, scheduleJob, shutdownCron } from '../src/daemon/cron.js';
import type { Config } from '../src/shared/types.js';

let tmpDir: string;

describe('cron jobs', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cron-'));
    initCron(createConfig(), {} as Client, tmpDir);
  });

  afterEach(() => {
    shutdownCron();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores the final reminder message instead of a meta instruction and defaults to run-once', () => {
    scheduleJob({
      cronExpression: '0 9 * * *',
      message: 'Hey, Yamato, drink water.',
      channelId: '123',
      authorId: 'owner',
    });

    const [job] = listJobs();
    expect(job.message).toBe('Hey, Yamato, drink water.');
    expect(job.runOnce).toBe(true);
  });
});

function createConfig(): Config {
  return {
    discordBotToken: '',
    discordChannelId: '123',
    ownerIds: [],
    discordBossId: 'owner',
    allowedChannelIds: ['123'],
    allowedUserIds: [],
    allowedAgentIds: [],
    daemonApiToken: '',
    peerAgentId: '',
    reportingChannelId: '',
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
}
