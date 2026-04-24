import { beforeEach, describe, expect, it } from 'vitest';
import { ChannelType, type Client } from 'discord.js';
import {
  buildGuildChannelMap,
  getChannelMapContext,
  getChannelMapEntries,
  resolveDiscoveredChannel,
} from '../src/daemon/channels.js';

describe('channel discovery', () => {
  beforeEach(async () => {
    const client = createClientStub();
    await buildGuildChannelMap(client);
  });

  it('lists each discovered channel only once in prompt context', () => {
    const entries = getChannelMapEntries();
    expect(entries).toEqual([
      ['boardroom', { id: '222', name: 'boardroom' }],
      ['general', { id: '111', name: 'general' }],
    ]);

    const context = getChannelMapContext();
    expect(context.match(/#general/g)?.length ?? 0).toBe(1);
    expect(context.match(/#boardroom/g)?.length ?? 0).toBe(1);
  });

  it('resolves ids, mentions, and #channel aliases to the same discovered target', async () => {
    await expect(resolveDiscoveredChannel('general')).resolves.toEqual({ id: '111', name: 'general' });
    await expect(resolveDiscoveredChannel('#general')).resolves.toEqual({ id: '111', name: 'general' });
    await expect(resolveDiscoveredChannel('<#111>')).resolves.toEqual({ id: '111', name: 'general' });
    await expect(resolveDiscoveredChannel('111')).resolves.toEqual({ id: '111', name: 'general' });
  });
});

function createClientStub(): Client {
  const guild = {
    channels: {
      fetch: async () => new Map([
        ['111', { type: ChannelType.GuildText, name: 'general' }],
        ['222', { type: ChannelType.GuildText, name: 'boardroom' }],
      ]),
    },
  };

  return {
    guilds: {
      fetch: async (id?: string) => {
        if (id) {
          return guild as any;
        }
        return new Map([['guild-1', {}]]);
      },
    },
  } as unknown as Client;
}
