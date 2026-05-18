import { beforeEach, describe, expect, it } from 'vitest';
import { ChannelType, type Client } from 'discord.js';
import {
  buildGuildChannelMap,
  getChannelMapContext,
  getChannelMapEntries,
  resolveDiscoveredChannel,
  processCrossChannelSends,
} from '../src/daemon/channels.js';

describe('channel discovery', () => {
  beforeEach(async () => {
    const client = createClientStub();
    await buildGuildChannelMap(client);
  });

  it('lists each discovered channel only once in prompt context', () => {
    const entries = getChannelMapEntries();
    expect(entries).toEqual([
      ['boardroom', { id: '222', name: 'boardroom', guildId: 'guild-1', guildName: 'Test Guild' }],
      ['general', { id: '111', name: 'general', guildId: 'guild-1', guildName: 'Test Guild' }],
    ]);

    const context = getChannelMapContext();
    expect(context.match(/#general/g)?.length ?? 0).toBe(1);
    expect(context.match(/#boardroom/g)?.length ?? 0).toBe(1);
  });

  it('resolves ids, mentions, and #channel aliases to the same discovered target', async () => {
    await expect(resolveDiscoveredChannel('general')).resolves.toMatchObject({ id: '111', name: 'general', guildId: 'guild-1' });
    await expect(resolveDiscoveredChannel('#general')).resolves.toMatchObject({ id: '111', name: 'general', guildId: 'guild-1' });
    await expect(resolveDiscoveredChannel('<#111>')).resolves.toMatchObject({ id: '111', name: 'general', guildId: 'guild-1' });
    await expect(resolveDiscoveredChannel('111')).resolves.toMatchObject({ id: '111', name: 'general', guildId: 'guild-1' });
  });

  it('does not resolve duplicate bare channel names', async () => {
    const client = createDuplicateClientStub();
    await buildGuildChannelMap(client);

    await expect(resolveDiscoveredChannel('general')).resolves.toBeNull();
    await expect(resolveDiscoveredChannel('333')).resolves.toMatchObject({ id: '333', guildId: 'guild-2' });
  });

  it('strips legacy cross-channel directives without sending', async () => {
    const send = async () => {
      throw new Error('should not send');
    };
    const client = {
      channels: {
        fetch: async () => ({ send }),
      },
    } as unknown as Client;

    const result = await processCrossChannelSends('hello\n[SEND:#general]secret[/SEND]', client, { allowPrivileged: true });

    expect(result.messageIds).toEqual([]);
    expect(result.cleanedResponse).toContain('hello');
    expect(result.cleanedResponse).toContain('Ignored legacy cross-channel send directive');
  });
});

function createClientStub(): Client {
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
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

function createDuplicateClientStub(): Client {
  const guilds = new Map([
    ['guild-1', {
      id: 'guild-1',
      name: 'Guild One',
      channels: { fetch: async () => new Map([['111', { type: ChannelType.GuildText, name: 'general' }]]) },
    }],
    ['guild-2', {
      id: 'guild-2',
      name: 'Guild Two',
      channels: { fetch: async () => new Map([['333', { type: ChannelType.GuildText, name: 'general' }]]) },
    }],
  ]);

  return {
    guilds: {
      fetch: async (id?: string) => {
        if (id) return guilds.get(id) as any;
        return new Map([...guilds.keys()].map((guildId) => [guildId, {}]));
      },
    },
  } as unknown as Client;
}
