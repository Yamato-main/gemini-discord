import { describe, expect, it } from 'vitest';
import { extractMentionContext, formatMentionContextBlock } from '../src/daemon/mentions.js';

function mockMessage(overrides: {
  content?: string;
  users?: Array<{ id: string; username: string; globalName?: string; bot?: boolean }>;
  roles?: Array<{ id: string; name: string }>;
  channels?: Array<{ id: string; name: string }>;
  everyone?: boolean;
  has?: (id: string) => boolean;
} = {}) {
  const users = new Map((overrides.users ?? []).map((user) => [user.id, user]));
  const roles = new Map((overrides.roles ?? []).map((role) => [role.id, role]));
  const channels = new Map((overrides.channels ?? []).map((channel) => [channel.id, channel]));

  return {
    content: overrides.content ?? '',
    mentions: {
      users: {
        values: () => users.values(),
      },
      roles: {
        values: () => roles.values(),
      },
      channels: {
        values: () => channels.values(),
      },
      everyone: overrides.everyone ?? false,
      has: overrides.has ?? ((id: string) => users.has(id)),
    },
  } as any;
}

describe('mention context', () => {
  const botUser = { id: '999999999999999999', username: 'jarvis', tag: 'JARVIS#0001', globalName: 'JARVIS' };

  it('labels bot identity and a human user ping separately from the bot ping', () => {
    const context = extractMentionContext(
      mockMessage({
        content: '<@999999999999999999> add <@222222222222222222>',
        users: [
          { id: '999999999999999999', username: 'jarvis', globalName: 'JARVIS', bot: true },
          { id: '222222222222222222', username: 'dpunk', globalName: 'Dpunk' },
        ],
        has: (id) => id === '999999999999999999' || id === '222222222222222222',
      }),
      botUser,
    );

    expect(context?.pingedBot).toBe(true);
    expect(context?.users).toHaveLength(2);
    const block = formatMentionContextBlock(context);
    expect(block).toContain('pinged this bot');
    expect(block).toContain('Dpunk');
    expect(block).toContain('`222222222222222222`');
    expect(block).toContain('this bot');
    expect(block).toContain('human');
  });

  it('distinguishes role pings and @everyone from user pings', () => {
    const context = extractMentionContext(
      mockMessage({
        users: [],
        roles: [{ id: '333333333333333333', name: 'mods' }],
        everyone: true,
      }),
      botUser,
    );

    const block = formatMentionContextBlock(context);
    expect(block).toContain('@everyone or @here');
    expect(block).toContain('Role pings');
    expect(block).toContain('@mods');
    expect(block).toContain('No **user** pings');
  });

  it('always exposes bot identity even when the message has no mentions', () => {
    const context = extractMentionContext(mockMessage(), botUser);
    const block = formatMentionContextBlock(context);
    expect(block).toContain('This bridge bot');
    expect(block).toContain('`999999999999999999`');
    expect(block).toContain('did **not** ping this bot');
  });

  it('formats mention context compactly when mode is compact', () => {
    const context = extractMentionContext(
      mockMessage({
        content: 'hello <@222222222222222222>',
        users: [{ id: '222222222222222222', username: 'dpunk', globalName: 'Dpunk' }],
        roles: [{ id: '333333333333333333', name: 'mods' }],
        everyone: true,
      }),
      botUser,
    );
    const block = formatMentionContextBlock(context, 'compact');
    expect(block).toBe('[Mentions: @everyone/@here | users: Dpunk (222222222222222222) | roles: @mods]');
  });
});
