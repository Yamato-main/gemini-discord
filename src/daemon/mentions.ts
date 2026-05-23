import type { Message } from 'discord.js';
import type { DiscordMentionContext } from '../shared/types.js';

export type { DiscordMentionContext };

export interface MentionedUserSnapshot {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
  isSelf: boolean;
}

export interface MentionedRoleSnapshot {
  id: string;
  name: string;
}

export interface MentionedChannelSnapshot {
  id: string;
  name: string;
}

export function extractMentionContext(
  message: Message,
  botUser: { id: string; username: string; tag?: string | null; globalName?: string | null } | null,
): DiscordMentionContext | null {
  if (!botUser) {
    return null;
  }

  const botTag = botUser.tag ?? botUser.username;
  const botDisplayName = botUser.globalName?.trim() || botUser.username;

  const users: MentionedUserSnapshot[] = [];
  for (const user of message.mentions.users.values()) {
    const displayName = user.globalName?.trim() || user.displayName?.trim() || user.username;
    users.push({
      id: user.id,
      username: user.username,
      displayName,
      bot: user.bot,
      isSelf: user.id === botUser.id,
    });
  }

  const roles: MentionedRoleSnapshot[] = [];
  for (const role of message.mentions.roles.values()) {
    roles.push({ id: role.id, name: role.name });
  }

  const channels: MentionedChannelSnapshot[] = [];
  for (const channel of message.mentions.channels.values()) {
    const name = 'name' in channel && typeof channel.name === 'string' ? channel.name : channel.id;
    channels.push({ id: channel.id, name });
  }

  const pingedBot = message.mentions.has(botUser.id);
  const everyoneOrHere = message.mentions.everyone;

  return {
    bot: { id: botUser.id, username: botUser.username, tag: botTag, displayName: botDisplayName },
    pingedBot,
    everyoneOrHere,
    users,
    roles,
    channels,
  };
}

export function formatMentionContextBlock(
  context: DiscordMentionContext | null | undefined,
  mode: 'full' | 'compact' = 'full'
): string {
  if (!context) {
    return '';
  }

  if (mode === 'compact') {
    const parts: string[] = [];
    if (context.pingedBot) {
      parts.push('pingedBot');
    }
    if (context.everyoneOrHere) {
      parts.push('@everyone/@here');
    }
    if (context.users.length > 0) {
      parts.push(`users: ${context.users.map((u) => `${u.displayName} (${u.id})`).join(', ')}`);
    }
    if (context.roles.length > 0) {
      parts.push(`roles: ${context.roles.map((r) => `@${r.name}`).join(', ')}`);
    }
    if (context.channels.length > 0) {
      parts.push(`channels: ${context.channels.map((c) => `#${c.name}`).join(', ')}`);
    }
    if (parts.length === 0) {
      return '';
    }
    return `[Mentions: ${parts.join(' | ')}]`;
  }

  const lines: string[] = [
    '[Mentions]',
    `- This bridge bot: **${context.bot.displayName}** (@${context.bot.username}) — id \`${context.bot.id}\` — tag ${context.bot.tag}`,
  ];

  if (context.pingedBot) {
    lines.push('- The incoming message **pinged this bot** (`<@…>` user mention). Respond to the user.');
  } else {
    lines.push('- The incoming message did **not** ping this bot.');
  }

  if (context.everyoneOrHere) {
    lines.push('- Contains **@everyone or @here** (broadcast mention, not a specific user).');
  }

  if (context.users.length > 0) {
    lines.push('- **User pings** (real `<@userId>` mentions — not plain @text):');
    for (const user of context.users) {
      const kind = user.isSelf
        ? 'this bot'
        : user.bot
          ? 'bot account'
          : 'human';
      lines.push(`  - ${user.displayName} (@${user.username}, ${kind}): \`${user.id}\``);
    }
  } else {
    lines.push('- No **user** pings in this message.');
  }

  if (context.roles.length > 0) {
    lines.push('- **Role pings** (`<@&roleId>` — not users):');
    for (const role of context.roles) {
      lines.push(`  - @${role.name}: \`${role.id}\``);
    }
  }

  if (context.channels.length > 0) {
    lines.push('- **Channel references** (`<#channelId>`):');
    for (const channel of context.channels) {
      lines.push(`  - #${channel.name}: \`${channel.id}\``);
    }
  }

  lines.push(
    '- Plain `@Name` text without a resolved user ping above is **not** a Discord mention. Use `discord_admin` action `users` to resolve people by name.',
    '- Do not treat role pings, channel refs, @everyone/@here, or this bot\'s username as a human user target unless the user clearly means that.',
  );

  return lines.join('\n');
}
