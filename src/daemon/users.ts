import type { Client, Guild, GuildMember } from 'discord.js';
import type { Config } from '../shared/types.js';
import { log } from './log.js';

export interface DiscoveredUserTarget {
  id: string;
  username: string;
  displayName?: string;
  globalName?: string;
  tag?: string;
  guildId: string;
  guildName?: string;
  bot?: boolean;
}

const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;

const userAliasMap = new Map<string, Set<string>>();
const discoveredUsers = new Map<string, DiscoveredUserTarget>();
let lastUserMapRefresh = 0;
const USER_MAP_TTL_MS = 10 * 60 * 1000;

export async function buildGuildUserMap(
  client: Client,
  config?: Config,
  options: { query?: string; limit?: number } = {},
): Promise<void> {
  userAliasMap.clear();
  discoveredUsers.clear();

  for (const guild of await resolveGuilds(client, config)) {
    try {
      const members = options.query?.trim()
        ? await guild.members.fetch({ query: options.query.trim(), limit: options.limit ?? 25 })
        : await guild.members.fetch();

      for (const [, member] of members) {
        registerDiscoveredUser(memberToTarget(member, guild));
      }
    } catch (err) {
      log.warn('Failed to fetch users for guild', {
        guildId: guild.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  lastUserMapRefresh = Date.now();
  log.info('User map built', { users: discoveredUsers.size });
}

export function getUserMapEntries(guildId?: string): DiscoveredUserTarget[] {
  return [...discoveredUsers.values()]
    .filter((entry) => !guildId || entry.guildId === guildId)
    .sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)));
}

export async function resolveDiscoveredUser(
  query: string,
  client?: Client | null,
  config?: Config,
): Promise<DiscoveredUserTarget | null> {
  const id = extractDiscordUserId(query);
  if (id) {
    const cached = discoveredUsers.get(id);
    if (cached) return cached;

    if (client) {
      const fetched = await fetchMemberById(client, id, config);
      if (fetched) return fetched;
    }

    return null;
  }

  const cached = resolveUserFromCache(query);
  if (cached) return cached;
  if (!client) return null;

  await buildGuildUserMap(client, config, { query, limit: 25 });
  return resolveUserFromCache(query);
}

function registerDiscoveredUser(user: DiscoveredUserTarget): void {
  discoveredUsers.set(user.id, user);
  const aliases = new Set<string>([
    user.id,
    `<@${user.id}>`,
    `<@!${user.id}>`,
    user.username,
    user.tag ?? '',
    user.displayName ?? '',
    user.globalName ?? '',
  ].filter(Boolean));

  for (const alias of aliases) {
    addAlias(alias, user.id);
    addAlias(alias.toLowerCase(), user.id);
  }
}

function addAlias(alias: string, id: string): void {
  const trimmed = alias.trim();
  if (!trimmed) return;
  const existing = userAliasMap.get(trimmed) ?? new Set<string>();
  existing.add(id);
  userAliasMap.set(trimmed, existing);
}

function resolveUserFromCache(query: string): DiscoveredUserTarget | null {
  const candidates = normalizeUserQuery(query);
  for (const candidate of candidates) {
    const ids = userAliasMap.get(candidate);
    if (!ids || ids.size !== 1) continue;
    const [id] = ids;
    return discoveredUsers.get(id) ?? null;
  }

  return null;
}

function normalizeUserQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const values = new Set([trimmed, trimmed.toLowerCase()]);
  const id = extractDiscordUserId(trimmed);
  if (id) values.add(id);
  return [...values];
}

function extractDiscordUserId(query: string): string | null {
  const trimmed = query.trim();
  if (DISCORD_SNOWFLAKE_RE.test(trimmed)) return trimmed;
  const mention = trimmed.match(/^<@!?(\d{15,25})>$/);
  return mention?.[1] ?? null;
}

async function fetchMemberById(
  client: Client,
  userId: string,
  config?: Config,
): Promise<DiscoveredUserTarget | null> {
  for (const guild of await resolveGuilds(client, config)) {
    try {
      const member = await guild.members.fetch({ user: userId, cache: true });
      const target = memberToTarget(member, guild);
      registerDiscoveredUser(target);
      return target;
    } catch {
      // Try the next scoped guild.
    }
  }

  return null;
}

async function resolveGuilds(client: Client, config?: Config): Promise<Guild[]> {
  if (config?.discordServerId) {
    const guild = await client.guilds.fetch(config.discordServerId);
    return [guild];
  }

  const refs = await client.guilds.fetch();
  const guilds: Guild[] = [];
  for (const [guildId] of refs) {
    guilds.push(await client.guilds.fetch(guildId));
  }
  return guilds;
}

function memberToTarget(member: GuildMember, guild: Guild): DiscoveredUserTarget {
  return {
    id: member.user.id,
    username: member.user.username,
    displayName: member.displayName,
    globalName: member.user.globalName ?? undefined,
    tag: member.user.tag,
    guildId: guild.id,
    guildName: guild.name,
    bot: member.user.bot,
  };
}

function displayLabel(user: DiscoveredUserTarget): string {
  return user.displayName || user.globalName || user.username || user.id;
}
