import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Client } from 'discord.js';
import { initCron, listJobs, scheduleJob, scheduleReminder, shutdownCron } from '../src/daemon/cron.js';
import type { Config } from '../src/shared/types.js';

let tmpDir: string;

describe('cron jobs', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cron-'));
    initCron(createConfig(), {} as Client, tmpDir);
  });

  afterEach(() => {
    shutdownCron();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores the final reminder message instead of a meta instruction and defaults to run-once', () => {
    scheduleJob({
      cronExpression: '0 9 * * *',
      message: 'Update: drink water.',
      channelId: '123',
      authorId: 'owner',
    });

    const [job] = listJobs();
    expect(job.message).toBe('Update: drink water.');
    expect(job.runOnce).toBe(true);
  });

  it('supports simple delay-based reminders without requiring raw cron syntax', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T10:00:00.000Z'));

    scheduleReminder({
      message: 'Reminder: stretch now.',
      channelId: '123',
      authorId: 'owner',
      delayMinutes: 15,
    });

    const [job] = listJobs();
    expect(job.message).toBe('Reminder: stretch now.');
    expect(job.runOnce).toBe(true);
    expect(job.cronExpression).toBe('once:2026-05-01T10:15:00.000Z');
    expect(job.nextRun).toBe(new Date('2026-05-01T10:15:00.000Z').getTime());
  });
});

function createConfig(): Config {
  return {
    discordBotToken: '',
    discordChannelId: '123',
    discordServerId: '',
    discordServerName: '',
    ownerIds: [],
    discordAdminId: 'owner',
    allowedChannelIds: ['123'],
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
