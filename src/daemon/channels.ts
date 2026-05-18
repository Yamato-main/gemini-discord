/**
 * Channel discovery & cross-channel messaging.
 *
 * Builds a map of all text channels visible to the bot on startup.
 * Provides getChannelMapContext() for system prompt injection and
 * processCrossChannelSends() for parsing/executing cross-channel directives.
 */

import type { Client, Guild } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { Config } from '../shared/types.js';
import { log } from './log.js';

export interface DiscoveredChannelTarget {
  id: string;
  name: string;
  guildId: string;
  guildName?: string;
}

/** Alias lookup for ids, names, mentions, and #name handles. */
const channelAliasMap = new Map<string, Set<string>>();
/** Unique discovered channels keyed by id for prompt/status rendering. */
const discoveredChannels = new Map<string, DiscoveredChannelTarget>();
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
export async function buildGuildChannelMap(client: Client, config?: Config): Promise<void> {
  channelAliasMap.clear();
  discoveredChannels.clear();

  for (const guild of await resolveGuilds(client, config)) {
    try {
      const channels = await guild.channels.fetch();
      for (const [channelId, channel] of channels) {
        if (!channel) continue;
        if (!isDiscoverableChannel(channelId, channel, config, guild.id)) continue;
        if (
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement ||
          channel.type === ChannelType.GuildForum
        ) {
          registerDiscoveredChannel({
            id: channelId,
            name: channel.name,
            guildId: guild.id,
            guildName: guild.name,
          });
        }
      }
    } catch (err) {
      log.error('Failed to fetch channels for guild', {
        guildId: guild.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  lastChannelMapRefresh = Date.now();
  log.info('Channel map built', {
    channels: discoveredChannels.size,
    names: [...discoveredChannels.values()].map((channel) => channel.name).join(', '),
  });
}

/**
 * Build a channel list string for inclusion in system prompts.
 */
export function getChannelMapEntries(): Array<[string, DiscoveredChannelTarget]> {
  return Array.from(discoveredChannels.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((channel) => [channel.name, channel] as [string, DiscoveredChannelTarget]);
}

export function getChannelMapContext(): string {
  if (discoveredChannels.size === 0) return '';
  const lines = getChannelMapEntries().map(
    ([name, { id, guildName }]) => `- #${name}${guildName ? ` (${guildName})` : ''} → <#${id}>`,
  );
  return `\n## Server Channels\nAvailable channels for explicit Discord tool calls:\n${lines.join('\n')}`;
}

export async function resolveDiscoveredChannel(
  query: string,
  client?: Client | null,
  config?: Config,
): Promise<DiscoveredChannelTarget | null> {
  const cached = resolveChannelFromCache(query);
  if (cached) {
    return cached;
  }

  if (!client) {
    return null;
  }

  await buildGuildChannelMap(client, config);
  return resolveChannelFromCache(query);
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
  _client: Client,
  _options: { allowPrivileged?: boolean } = {},
): Promise<{ cleanedResponse: string; messageIds: string[] }> {
  const { cleanedResponse, directives } = extractCrossChannelSends(response);
  if (directives.length === 0) {
    return { cleanedResponse: response, messageIds: [] };
  }

  return {
    cleanedResponse: appendNotices(cleanedResponse, [
      '*(Ignored legacy cross-channel send directive. Use the Discord message tool with an explicit channel_id.)*',
    ]),
    messageIds: [],
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

function registerDiscoveredChannel(channel: DiscoveredChannelTarget): void {
  discoveredChannels.set(channel.id, channel);
  const aliases = new Set([
    channel.id,
    channel.name,
    channel.name.toLowerCase(),
    `#${channel.name}`,
    `#${channel.name.toLowerCase()}`,
    `<#${channel.id}>`,
  ]);

  for (const alias of aliases) {
    addAlias(alias, channel.id);
  }
}

function resolveChannelFromCache(query: string): DiscoveredChannelTarget | null {
  const normalized = normalizeChannelQuery(query);
  for (const candidate of normalized) {
    const ids = channelAliasMap.get(candidate);
    if (!ids || ids.size !== 1) continue;
    const [id] = ids;
    return discoveredChannels.get(id) ?? null;
  }

  return null;
}

function addAlias(alias: string, id: string): void {
  const existing = channelAliasMap.get(alias) ?? new Set<string>();
  existing.add(id);
  channelAliasMap.set(alias, existing);
}

function normalizeChannelQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const values = new Set<string>([trimmed, trimmed.toLowerCase()]);
  const withoutHash = trimmed.replace(/^#/, '');
  values.add(withoutHash);
  values.add(withoutHash.toLowerCase());

  const mentionMatch = trimmed.match(/^<#([0-9]+)>$/);
  if (mentionMatch) {
    values.add(mentionMatch[1]);
  }

  return [...values];
}

async function resolveGuilds(client: Client, config?: Config): Promise<Guild[]> {
  if (config?.discordServerId) {
    return [await client.guilds.fetch(config.discordServerId)];
  }

  const refs = await client.guilds.fetch();
  const guilds: Guild[] = [];
  for (const [guildId] of refs) {
    guilds.push(await client.guilds.fetch(guildId));
  }
  return guilds;
}

function isDiscoverableChannel(
  channelId: string,
  _channel: { type: ChannelType },
  config: Config | undefined,
  guildId: string,
): boolean {
  if (!config) return true;
  if (config.allowedChannelIds.includes(channelId)) return true;
  return config.allowedChannelIds.length === 0
    && Boolean(config.discordServerId)
    && guildId === config.discordServerId;
}
