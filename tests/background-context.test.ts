import { describe, expect, it } from 'vitest';
import { buildBackgroundOperationsContext } from '../src/daemon/background-context.js';
import type { BackgroundOperationsSnapshot } from '../src/daemon/background-context.js';

function snapshot(overrides: Partial<BackgroundOperationsSnapshot> = {}): BackgroundOperationsSnapshot {
  return {
    cronJobs: [],
    watchJobs: [],
    autonomous: {
      enabled: false,
      running: false,
      intervalMs: 300000,
      targetChannelId: '',
      targetChannelName: '',
      sources: [],
    },
    ...overrides,
  };
}

describe('buildBackgroundOperationsContext', () => {
  it('summarizes background scripts and Gemini role boundaries', () => {
    const context = buildBackgroundOperationsContext(snapshot(), {
      channelId: 'chan-1',
      channelName: 'yamato-samurai',
    });

    expect(context).toContain('[Background Operations]');
    expect(context).toContain('Scripts and collectors do background polling/data gathering.');
    expect(context).toContain('Gemini wakes later for reasoning, fact-checking, and reporting.');
    expect(context).toContain('Active cron jobs: 0.');
    expect(context).toContain('Active watch/research jobs: 0.');
    expect(context).toContain('Autonomous monitoring: disabled');
  });

  it('prioritizes jobs targeting the current channel and truncates long text', () => {
    const context = buildBackgroundOperationsContext(snapshot({
      cronJobs: [
        {
          id: 'elsewhere',
          cronExpression: '* * * * *',
          message: 'post somewhere else',
          channelId: 'chan-9',
          authorId: 'owner',
          nextRun: Date.parse('2026-04-24T10:10:00.000Z'),
          runOnce: false,
        },
        {
          id: 'local',
          cronExpression: '* * * * *',
          message: 'Hey, Yamato drink water and take a short break before continuing the mission.',
          channelId: 'chan-1',
          authorId: 'owner',
          nextRun: Date.parse('2026-04-24T10:05:00.000Z'),
          runOnce: true,
        },
      ],
      watchJobs: [
        {
          id: 'watch-1',
          source: '4chan_a_watch',
          topic: 'One Piece spoiler thread monitoring',
          board: 'a',
          keywords: ['one piece', 'spoilers'],
          channelId: 'chan-1',
          channelName: 'yamato-samurai',
          dueAt: '2026-04-24T10:30:00.000Z',
          pollEveryMs: 300000,
          status: 'collecting',
          lastPollAt: '2026-04-24T10:02:00.000Z',
          lastPostedAt: null,
          lastSignalScore: 6,
          lastDecision: 'gathering more signal',
          lastError: null,
        },
      ],
      autonomous: {
        enabled: true,
        running: false,
        intervalMs: 1800000,
        targetChannelId: 'chan-2',
        targetChannelName: 'updates',
        sources: [
          {
            id: '4chan-a',
            lastPollAt: '2026-04-24T10:00:00.000Z',
            lastEvaluatedAt: '2026-04-24T10:01:00.000Z',
            lastPostedAt: null,
            lastSignalScore: 4,
            lastDecision: 'monitoring',
            lastError: null,
          },
        ],
      },
    }), {
      channelId: 'chan-1',
      channelName: 'yamato-samurai',
    });

    expect(context).toContain('Cron `local` -> this channel (#yamato-samurai)');
    expect(context).toContain('Watch `watch-1` -> this channel (#yamato-samurai)');
    expect(context).toContain('Autonomous monitoring: enabled and armed');
    expect(context).toContain('target #updates');
    expect(context).toContain('Source `4chan-a` -> monitoring | signal 4');
    expect(context).toContain('Hey, Yamato drink water');
    expect(context).toContain('…');
  });
});
