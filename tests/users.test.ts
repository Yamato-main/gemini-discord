import { beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'discord.js';
import {
  buildGuildUserMap,
  getUserMapEntries,
  resolveDiscoveredUser,
} from '../src/daemon/users.js';

describe('user discovery', () => {
  beforeEach(async () => {
    await buildGuildUserMap(createClientStub());
  });

  it('lists discovered users as metadata keyed by stable Discord id', () => {
    expect(getUserMapEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '111111111111111111', username: 'yamato', displayName: 'Yamato' }),
      expect.objectContaining({ id: '222222222222222222', username: 'bb_software_dev', displayName: 'bb software dev' }),
    ]));
  });

  it('resolves stable ids and mentions before name aliases', async () => {
    await expect(resolveDiscoveredUser('222222222222222222')).resolves.toMatchObject({ id: '222222222222222222' });
    await expect(resolveDiscoveredUser('<@222222222222222222>')).resolves.toMatchObject({ id: '222222222222222222' });
    await expect(resolveDiscoveredUser('bb software dev')).resolves.toMatchObject({ id: '222222222222222222' });
  });

  it('does not resolve ambiguous display names', async () => {
    await buildGuildUserMap(createDuplicateNameClientStub());

    await expect(resolveDiscoveredUser('alex')).resolves.toBeNull();
    await expect(resolveDiscoveredUser('333333333333333333')).resolves.toMatchObject({ id: '333333333333333333' });
  });
});

function createClientStub(): Client {
  const members = new Map([
    ['111111111111111111', createMember('111111111111111111', 'yamato', 'Yamato')],
    ['222222222222222222', createMember('222222222222222222', 'bb_software_dev', 'bb software dev')],
  ]);
  return createClientWithMembers(members);
}

function createDuplicateNameClientStub(): Client {
  const members = new Map([
    ['333333333333333333', createMember('333333333333333333', 'alex_one', 'alex')],
    ['444444444444444444', createMember('444444444444444444', 'alex_two', 'alex')],
  ]);
  return createClientWithMembers(members);
}

function createClientWithMembers(members: Map<string, any>): Client {
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    members: {
      fetch: async (options?: any) => {
        if (!options || Object.keys(options).length === 0) return members;
        if (typeof options === 'string') return members.get(options);
        if (options.user) return members.get(options.user);
        if (options.query) {
          const needle = String(options.query).toLowerCase();
          return new Map([...members].filter(([, member]) =>
            member.user.username.toLowerCase().includes(needle)
            || member.displayName.toLowerCase().includes(needle),
          ));
        }
        return members;
      },
    },
  };

  return {
    guilds: {
      fetch: async (id?: string) => {
        if (id) return guild as any;
        return new Map([['guild-1', {}]]);
      },
    },
  } as unknown as Client;
}

function createMember(id: string, username: string, displayName: string) {
  return {
    displayName,
    user: {
      id,
      username,
      globalName: displayName,
      tag: `${username}#0000`,
      bot: false,
    },
  };
}
