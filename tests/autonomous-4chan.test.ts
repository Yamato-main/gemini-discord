import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/shared/types.js';
import { ensureGeminiBindingWorkspace } from '../src/daemon/binding.js';
import { collectFourChanAwaySignal, getFourChanAutonomousBindingKey } from '../src/daemon/autonomous-4chan.js';

let tmpDir: string;

describe('collectFourChanAwaySignal', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-autonomous-'));
    fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Persona\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.geminiignore'), 'discord-attachments/\n', 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('wakes Gemini when /a/ signal crosses the threshold and avoids re-waking on the same evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {
        threads: [
          {
            no: 777,
            sub: 'One Piece chapter chatter',
            com: 'Spoilers are heating up &amp; the thread keeps moving.',
            replies: 42,
            images: 3,
            last_modified: 1710000000,
          },
        ],
      },
    ]), { status: 200 })) as typeof fetch);

    const workspace = ensureGeminiBindingWorkspace(tmpDir, getFourChanAutonomousBindingKey());
    const config = createConfig({
      autonomous: {
        enabled: true,
        intervalMs: 60_000,
        targetChannelId: 'reporting',
        targetChannelName: '',
        assumeMasterAway: true,
        fourChan: {
          enabled: true,
          board: 'a',
          keywords: ['one piece'],
          minSignal: 3,
          cooldownMs: 3_600_000,
          signalWindowMs: 1_800_000,
          timelineLimit: 50,
        },
      },
    });

    const first = await collectFourChanAwaySignal({
      config,
      extensionDir: tmpDir,
      bindingDir: workspace.bindingDir,
    });

    expect(first.decision).toBe('ready');
    expect(first.signalScore).toBeGreaterThanOrEqual(3);
    expect(first.wakeRequest?.bindingKey).toBe('autonomous:4chan-a');
    expect(first.wakeRequest?.prompt).toContain('Yamato is away');
    expect(fs.readFileSync(path.join(workspace.bindingDir, 'autonomous-briefing.md'), 'utf-8')).toContain('One Piece');

    await first.wakeRequest!.markEvaluated(true);

    const second = await collectFourChanAwaySignal({
      config,
      extensionDir: tmpDir,
      bindingDir: workspace.bindingDir,
    });

    expect(second.wakeRequest).toBeNull();
    expect(second.decision).toBe('already_evaluated');
  });

  it('stays asleep when no tracked /a/ threads match the configured keywords', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {
        threads: [
          {
            no: 888,
            sub: 'Comfy seasonal anime thread',
            com: 'No One Piece talk here.',
            replies: 8,
            images: 1,
            last_modified: 1710000000,
          },
        ],
      },
    ]), { status: 200 })) as typeof fetch);

    const workspace = ensureGeminiBindingWorkspace(tmpDir, getFourChanAutonomousBindingKey());
    const config = createConfig({
      autonomous: {
        enabled: true,
        intervalMs: 60_000,
        targetChannelId: 'reporting',
        targetChannelName: '',
        assumeMasterAway: true,
        fourChan: {
          enabled: true,
          board: 'a',
          keywords: ['evangelion'],
          minSignal: 2,
          cooldownMs: 3_600_000,
          signalWindowMs: 1_800_000,
          timelineLimit: 50,
        },
      },
    });

    const result = await collectFourChanAwaySignal({
      config,
      extensionDir: tmpDir,
      bindingDir: workspace.bindingDir,
    });

    expect(result.wakeRequest).toBeNull();
    expect(result.decision).toBe('no_relevant_threads');
  });
});

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    discordBotToken: 'token',
    discordChannelId: 'channel-1',
    ownerIds: ['owner-1'],
    discordBossId: 'owner-1',
    allowedChannelIds: ['channel-1'],
    allowedUserIds: ['owner-1'],
    allowedAgentIds: [],
    daemonApiToken: 'daemon-token',
    peerAgentId: 'peer-agent',
    reportingChannelId: 'reporting',
    discordPrefix: '!',
    discordResetCmd: '!reset',
    daemonPort: 18790,
    geminiPath: 'gemini',
    geminiModel: 'gemini-3.1-flash-lite-preview',
    geminiTimeoutMs: 300000,
    geminiMaxConcurrent: 3,
    conversationHistoryLength: 30,
    promptHistoryMessageLimit: 12,
    promptHistoryCharBudget: 6000,
    streaming: true,
    queueMaxDepth: 20,
    enableDMs: true,
    requireMention: false,
    respondToReplies: true,
    memoryScope: 'channel',
    autoStartDaemon: true,
    useGeminiCliSessions: true,
    geminiSessionBindingScope: 'channel',
    cliIdleTimeoutMs: 300000,
    autonomous: {
      enabled: false,
      intervalMs: 300000,
      targetChannelId: 'reporting',
      targetChannelName: '',
      assumeMasterAway: true,
      fourChan: {
        enabled: false,
        board: 'a',
        keywords: ['one piece'],
        minSignal: 3,
        cooldownMs: 3600000,
        signalWindowMs: 1800000,
        timelineLimit: 200,
      },
    },
    ...overrides,
  };
}
