import { describe, expect, it } from 'vitest';
import { buildBackgroundOperationsContext } from '../src/daemon/background-context.js';
import type { BackgroundOperationsSnapshot } from '../src/daemon/background-context.js';

function snapshot(overrides: Partial<BackgroundOperationsSnapshot> = {}): BackgroundOperationsSnapshot {
  return {
    cronJobs: [],
    ...overrides,
  };
}

describe('buildBackgroundOperationsContext', () => {
  it('summarizes scheduled Discord job state', () => {
    const context = buildBackgroundOperationsContext(snapshot(), {
      channelId: 'chan-1',
      channelName: 'team-room',
    });

    expect(context).toContain('[Background Operations]');
    expect(context).toContain('live runtime state for scheduled Discord jobs');
    expect(context).toContain('Active cron jobs: 0.');
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
          message: 'Update: drink water and take a short break before continuing with the next task.',
          channelId: 'chan-1',
          authorId: 'owner',
          nextRun: Date.parse('2026-04-24T10:05:00.000Z'),
          runOnce: true,
        },
      ],
    }), {
      channelId: 'chan-1',
      channelName: 'team-room',
    });

    expect(context).toContain('Cron `local` -> this channel (#team-room)');
    expect(context).toContain('Update: drink water');
    expect(context).toContain('…');
  });
});
