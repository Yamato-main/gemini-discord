/**
 * Channel discovery & cross-channel messaging.
 *
 * Builds a map of all text channels visible to the bot on startup.
 * Provides getChannelMapContext() for system prompt injection and
 * processCrossChannelSends() for parsing/executing cross-channel directives.
 */

import type { Client, TextChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { log } from './log.js';
import { chunkMessage } from '../shared/chunker.js';
import { sendDiscordMessage } from './sender.js';

/** name → { id, name } */
const guildChannelMap = new Map<string, { id: string; name: string }>();
let lastChannelMapRefresh = 0;
const CHANNEL_MAP_TTL_MS = 10 * 60 * 1000;
const RE_CROSS_SEND = /\[SEND:#([^\]]+)\]([\s\S]*?)\[\/SEND\]/g;

export interface CrossChannelDirective {
  target: string;
  content: string;
}

/**
 * Discover all text channels visible to the bot and store them.
 * Called once on clientReady.
 */
export async function buildGuildChannelMap(client: Client): Promise<void> {
  const now = Date.now();
  if (now - lastChannelMapRefresh < 5000) {
    return; // debounce rapid requests
  }

  guildChannelMap.clear();
  const guilds = await client.guilds.fetch();

  for (const [guildId] of guilds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      for (const [channelId, channel] of channels) {
        if (!channel) continue;
        if (
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement ||
          channel.type === ChannelType.GuildForum
        ) {
          guildChannelMap.set(channel.name, { id: channelId, name: channel.name });
          guildChannelMap.set(channelId, { id: channelId, name: channel.name });
        }
      }
    } catch (err) {
      log.error('Failed to fetch channels for guild', {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  lastChannelMapRefresh = Date.now();
  log.info('Channel map built', {
    channels: guildChannelMap.size,
    names: [...guildChannelMap.keys()].join(', '),
  });
}

/**
 * Build a channel list string for inclusion in system prompts.
 */
export function getChannelMapContext(): string {
  if (guildChannelMap.size === 0) return '';
  const lines = [...guildChannelMap.entries()].map(
    ([name, { id }]) => `- #${name} → <#${id}>`,
  );
  return `\n## Server Channels\nYou can send messages to other channels using the cross-channel directive.\nFormat: [SEND:#channel-name]your message here[/SEND]\nThe daemon will intercept this and post the message in the target channel.\nAvailable channels:\n${lines.join('\n')}`;
}

/**
 * Parse and execute cross-channel send directives from a response.
 * Format: [SEND:#channel-name]message content[/SEND]
 * Returns the response with directives stripped.
 */
export function extractCrossChannelSends(response: string): { cleanedResponse: string; directives: CrossChannelDirective[] } {
  const directives: CrossChannelDirective[] = [];

  const cleanedResponse = response.replace(RE_CROSS_SEND, (_, target: string, content: string) => {
    directives.push({
      target: target.trim(),
      content: content.trim(),
    });
    return '';
  });

  return {
    cleanedResponse: cleanedResponse.trim(),
    directives,
  };
}

export async function processCrossChannelSends(
  response: string,
  client: Client,
  options: { allowPrivileged?: boolean } = {},
): Promise<{ cleanedResponse: string; messageIds: string[] }> {
  const { cleanedResponse, directives } = extractCrossChannelSends(response);
  if (directives.length === 0) {
    return { cleanedResponse: response, messageIds: [] };
  }

  const allowPrivileged = options.allowPrivileged ?? true;
  const notices: string[] = [];
  const messageIds: string[] = [];

  if (!allowPrivileged) {
    notices.push('*(Blocked privileged send: only the Boss may send messages to other channels.)*');
    return {
      cleanedResponse: appendNotices(cleanedResponse, notices),
      messageIds,
    };
  }

  for (const directive of directives) {
    let target = guildChannelMap.get(directive.target);
    
    // Lazy refresh on failure or TTL expiration
    if (!target || Date.now() - lastChannelMapRefresh > CHANNEL_MAP_TTL_MS) {
      await buildGuildChannelMap(client);
      target = guildChannelMap.get(directive.target);
    }

    if (!target) {
      log.warn('Cross-channel send target not found', { target: directive.target });
      notices.push(`*(Could not find channel #${directive.target})*`);
      continue;
    }

    try {
      const channel = await client.channels.fetch(target.id);
      if (channel && 'send' in channel && typeof channel.send === 'function') {
        const sentIds = await sendDiscordMessage(channel as TextChannel, directive.content, chunkMessage);
        messageIds.push(...sentIds);
        log.info('Cross-channel message sent', {
          targetChannel: target.name,
          targetId: target.id,
          contentLength: directive.content.length,
        });
        notices.push(`*(Message sent to <#${target.id}>)*`);
      }
    } catch (err) {
      log.error('Cross-channel send failed', {
        target: directive.target,
        error: err instanceof Error ? err.message : String(err),
      });
      notices.push(`*(Failed to send to #${directive.target})*`);
    }
  }

  return {
    cleanedResponse: appendNotices(cleanedResponse, notices),
    messageIds,
  };
}

function appendNotices(cleaned: string, notices: string[]): string {
  if (notices.length === 0) {
    return cleaned;
  }

  if (!cleaned) {
    return notices.join('\n');
  }

  return `${cleaned}\n\n${notices.join('\n')}`;
}
