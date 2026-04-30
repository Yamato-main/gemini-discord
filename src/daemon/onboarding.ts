import {
  ChannelType,
  type Client,
  type Message,
} from 'discord.js';
import type { Config } from '../shared/types.js';
import {
  persistConfigEnvUpdates,
  persistDiscordMetadata,
} from '../shared/config.js';
import type { ManagedDiscordMetadata } from '../shared/managed-config.js';
import { log } from './log.js';

export async function bootstrapManagedDiscordConfig(
  client: Client,
  config: Config,
  extensionDir: string,
): Promise<void> {
  const envUpdates: Record<string, string> = {};
  const metadataUpdates: ManagedDiscordMetadata = {
    botUserId: client.user?.id ?? '',
    botTag: client.user?.tag ?? '',
    lastConnectedAt: new Date().toISOString(),
  };

  const ownerDiscovery = await discoverApplicationOwners(client);
  if (config.ownerIds.length === 0 && ownerDiscovery.ids.length > 0) {
    config.ownerIds = ownerDiscovery.ids;
    envUpdates.DISCORD_OWNER_IDS = ownerDiscovery.ids.join(',');

    if (!config.discordAdminId) {
      config.discordAdminId = ownerDiscovery.ids[0];
      envUpdates.DISCORD_ADMIN_ID = ownerDiscovery.ids[0];
    }

    if (config.allowedUserIds.length === 0) {
      config.allowedUserIds = [...ownerDiscovery.ids];
      envUpdates.DISCORD_ALLOWED_USER_IDS = ownerDiscovery.ids.join(',');
    }
  }

  if (ownerDiscovery.ids[0]) {
    metadataUpdates.appOwnerId = ownerDiscovery.ids[0];
  }
  if (ownerDiscovery.tags[0]) {
    metadataUpdates.appOwnerTag = ownerDiscovery.tags[0];
  }

  const channelDiscovery = await discoverGuildDefaults(client, config);
  if (channelDiscovery.primaryGuildId) {
    config.discordServerId = channelDiscovery.primaryGuildId;
    metadataUpdates.primaryGuildId = channelDiscovery.primaryGuildId;
  }
  if (channelDiscovery.primaryGuildName) {
    config.discordServerName = channelDiscovery.primaryGuildName;
    metadataUpdates.primaryGuildName = channelDiscovery.primaryGuildName;
  }
  if (!config.discordChannelId && channelDiscovery.primaryChannelId) {
    config.discordChannelId = channelDiscovery.primaryChannelId;
    envUpdates.DISCORD_CHANNEL_ID = channelDiscovery.primaryChannelId;
    metadataUpdates.primaryChannelId = channelDiscovery.primaryChannelId;
  }
  if (channelDiscovery.primaryChannelName) {
    metadataUpdates.primaryChannelName = channelDiscovery.primaryChannelName;
  }
  if (config.allowedChannelIds.length === 0 && channelDiscovery.allowedChannelIds.length > 0) {
    config.allowedChannelIds = [...channelDiscovery.allowedChannelIds];
    envUpdates.DISCORD_ALLOWED_CHANNEL_IDS = channelDiscovery.allowedChannelIds.join(',');
  }

  if (Object.keys(envUpdates).length > 0) {
    persistConfigEnvUpdates(extensionDir, envUpdates);
    log.info('Managed install config updated from Discord discovery', { envKeys: Object.keys(envUpdates) });
  }

  persistDiscordMetadata(extensionDir, metadataUpdates);
}

export function rememberPrimaryChannelFromMessage(
  config: Config,
  extensionDir: string,
  message: Message,
): void {
  if (!message.guildId) {
    return;
  }

  const envUpdates: Record<string, string> = {};
  const metadataUpdates: ManagedDiscordMetadata = {};
  let changed = false;

  if (!config.discordChannelId) {
    config.discordChannelId = message.channelId;
    envUpdates.DISCORD_CHANNEL_ID = message.channelId;
    changed = true;
  }

  if (!config.allowedChannelIds.includes(message.channelId)) {
    config.allowedChannelIds = [...config.allowedChannelIds, message.channelId];
    envUpdates.DISCORD_ALLOWED_CHANNEL_IDS = config.allowedChannelIds.join(',');
    changed = true;
  }

  if (!config.discordServerId && message.guildId) {
    config.discordServerId = message.guildId;
    changed = true;
  }

  if (!config.discordServerName && message.guild?.name) {
    config.discordServerName = message.guild.name;
    changed = true;
  }

  if (changed) {
    metadataUpdates.primaryGuildId = message.guildId;
    metadataUpdates.primaryGuildName = message.guild?.name;
    metadataUpdates.primaryChannelId = message.channelId;
    metadataUpdates.primaryChannelName = getChannelName(message);
    persistConfigEnvUpdates(extensionDir, envUpdates);
    persistDiscordMetadata(extensionDir, metadataUpdates);
    log.info('Managed primary channel remembered from owner activity', {
      channelId: message.channelId,
      guildId: message.guildId,
    });
  }
}

interface OwnerDiscovery {
  ids: string[];
  tags: string[];
}

interface GuildDiscoveryResult {
  primaryGuildId: string;
  primaryGuildName: string;
  primaryChannelId: string;
  primaryChannelName: string;
  allowedChannelIds: string[];
}

async function discoverApplicationOwners(client: Client): Promise<OwnerDiscovery> {
  try {
    const application = await client.application?.fetch();
    const owner = application?.owner as Record<string, unknown> | null | undefined;
    if (!owner) {
      return { ids: [], tags: [] };
    }

    if (typeof owner['id'] === 'string') {
      return {
        ids: [owner['id']],
        tags: typeof owner['tag'] === 'string' ? [owner['tag']] : [],
      };
    }

    if (typeof owner['ownerId'] === 'string') {
      return {
        ids: [owner['ownerId']],
        tags: [],
      };
    }
  } catch (err) {
    log.warn('Could not discover Discord application owner', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ids: [], tags: [] };
}

async function discoverGuildDefaults(client: Client, config: Config): Promise<GuildDiscoveryResult> {
  const result: GuildDiscoveryResult = {
    primaryGuildId: config.discordServerId,
    primaryGuildName: config.discordServerName,
    primaryChannelId: config.discordChannelId,
    primaryChannelName: '',
    allowedChannelIds: [...config.allowedChannelIds],
  };

  if (config.discordChannelId) {
    try {
      const channel = await client.channels.fetch(config.discordChannelId);
      if (channel && channel.type !== ChannelType.DM && 'guild' in channel && channel.guild) {
        result.primaryGuildId = channel.guild.id;
        result.primaryGuildName = channel.guild.name;
        result.primaryChannelName = 'name' in channel && typeof channel.name === 'string' ? channel.name : '';
      }
    } catch {
      // Defer to broader discovery below.
    }
  }

  const guildRefs = await client.guilds.fetch();
  if (guildRefs.size !== 1) {
    return result;
  }

  const [guildId] = guildRefs.keys();
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const eligible = channels
    .filter((channel) =>
      channel
      && (
        channel.type === ChannelType.GuildText
        || channel.type === ChannelType.GuildAnnouncement
      ),
    )
    .map((channel) => ({ id: channel!.id, name: channel!.name }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!result.primaryGuildId) {
    result.primaryGuildId = guild.id;
    result.primaryGuildName = guild.name;
  }

  if (result.allowedChannelIds.length === 0 && eligible.length > 0) {
    result.allowedChannelIds = eligible.map((channel) => channel.id);
  }

  if (!result.primaryChannelId && eligible.length === 1) {
    result.primaryChannelId = eligible[0].id;
    result.primaryChannelName = eligible[0].name;
  }

  return result;
}

function getChannelName(message: Message): string {
  if ('name' in message.channel && typeof message.channel.name === 'string') {
    return message.channel.name;
  }

  return `channel-${message.channelId}`;
}
