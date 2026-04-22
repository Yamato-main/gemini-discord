/**
 * Discord.js client setup — DM capable, agent-aware, and optimized for memory.
 */

import {
  Client,
  GatewayIntentBits,
  Options,
  Partials,
  type Message,
} from 'discord.js';
import type { Config } from '../shared/types.js';
import { log } from './log.js';
import { shouldAcceptMessage } from './routing.js';

export interface AcceptedDiscordMessage {
  content: string;
  speakerKind: 'human' | 'agent';
  trigger: string;
  channelName: string;
  guildName: string | null;
  replyToMessageId: string | null;
  replyToAuthorId: string | null;
  replyToAuthorName: string | null;
  isBoss: boolean;
}

export interface BotCallbacks {
  onMessage: (message: Message, accepted: AcceptedDiscordMessage) => void;
}

export function createClient(config: Config): Client {
  log.info('Client creating', { enableDMs: config.enableDMs, bossId: config.discordBossId });
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.MessageContent,
  ];

  if (config.enableDMs) {
    intents.push(GatewayIntentBits.DirectMessages);
    intents.push(GatewayIntentBits.DirectMessageTyping);
  }

  return new Client({
    intents,
    partials: config.enableDMs
      ? [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction, Partials.ThreadMember]
      : [],
    makeCache: Options.cacheWithLimits({
      MessageManager: { maxSize: 50 },
      GuildMemberManager: { maxSize: 10 },
      PresenceManager: { maxSize: 0 },
      ReactionManager: { maxSize: 0 },
      UserManager: { maxSize: 25 },
    }),
  });
}

export function setupReconnectHandlers(
  client: Client,
  config: Config,
  setState: (status: 'starting' | 'ready' | 'degraded') => void,
): void {
  client.on('shardError', (err) => {
    log.error('WebSocket error', { msg: err.message });
    setState('degraded');
  });

  client.on('shardDisconnect', (event) => {
    const fatal = [4004, 4010, 4011, 4012, 4013, 4014];
    if (fatal.includes(event.code)) {
      log.error('Fatal disconnect', { code: event.code });
      notifyOwner(client, config, `Bot disconnected fatally (code ${event.code}). Check token and intents.`);
      process.exit(1);
    }
    log.warn('Disconnected, reconnecting', { code: event.code });
    setState('degraded');
  });

  client.on('shardReconnecting', () => log.info('Reconnecting to Discord'));
  client.on('shardResume', () => {
    log.info('Connection resumed');
    setState('ready');
  });
}

export function setupMessageHandler(
  client: Client,
  config: Config,
  callbacks: BotCallbacks,
  isShuttingDown: () => boolean,
): void {
  client.on('messageCreate', async (message: Message) => {
    if (message.partial) {
      try {
        await message.fetch();
      } catch (err) {
        log.warn('Failed to fetch partial message', { error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    if (!message.author || isShuttingDown()) return;

    const isDM = !message.guild;
    const channelName = getChannelName(message);
    const guildName = message.guild?.name ?? null;

    // Fast-fail routing checks to avoid expensive Discord API calls
    if (message.author.id === client.user?.id) return;

    if (isDM) {
      if (!config.enableDMs) return;
      // Security: Only the configured Boss may DM the bot directly.
      if (message.author.id !== config.discordBossId) return;
    } else {
      if (!config.allowedChannelIds.includes(message.channelId)) return;
    }

    const replyContext = await getReplyContext(message);
    const isAllowedHuman = !message.author.bot && (config.allowedUserIds.includes(message.author.id) || config.ownerIds.includes(message.author.id));
    const isAllowedAgent = message.author.bot && config.allowedAgentIds.includes(message.author.id);
    if (!isAllowedHuman && !isAllowedAgent) return;

    const replyToMessageId = replyContext?.messageId ?? message.reference?.messageId ?? null;
    const mentionedBot = client.user ? message.mentions.has(client.user) : false;
    const hasPrefixTrigger = Boolean(config.discordPrefix) && message.content.trim().startsWith(config.discordPrefix);
    const repliedToBot = (mentionedBot || hasPrefixTrigger)
      ? false
      : config.respondToReplies && replyContext?.authorId === (client.user?.id ?? null);

    const decision = shouldAcceptMessage({
      authorId: message.author.id,
      authorTag: message.author.tag,
      isBot: message.author.bot,
      botUserId: client.user?.id ?? null,
      content: message.content,
      attachmentCount: message.attachments.size,
      channelId: message.channelId,
      channelName,
      guildId: message.guildId ?? null,
      guildName,
      isDM,
      mentionedBot,
      repliedToBot,
      replyToMessageId,
    }, config);

    if (!decision.accept || !decision.speakerKind || !decision.trigger) {
      return;
    }

    log.info('Accepted Discord message', {
      author: message.author.tag,
      authorId: message.author.id,
      speakerKind: decision.speakerKind,
      trigger: decision.trigger,
      channelId: message.channelId,
      channelName,
      guildId: message.guildId ?? null,
    });

    callbacks.onMessage(message, {
      content: decision.content,
      speakerKind: decision.speakerKind as 'human' | 'agent',
      trigger: decision.trigger,
      channelName,
      guildName,
      replyToMessageId,
      replyToAuthorId: replyContext?.authorId ?? null,
      replyToAuthorName: replyContext?.authorName ?? null,
      isBoss: message.author.id === config.discordBossId,
    });
  });
}

interface ReplyContext {
  messageId: string;
  authorId: string;
  authorName: string;
}

async function getReplyContext(
  message: Message,
): Promise<ReplyContext | null> {
  if (!message.reference?.messageId) {
    return null;
  }

  const cachedRef = message.channel.messages.cache.get(message.reference.messageId);
  if (cachedRef) {
    return {
      messageId: cachedRef.id,
      authorId: cachedRef.author.id,
      authorName: cachedRef.author.tag,
    };
  }

  try {
    const reference = await message.fetchReference();
    return {
      messageId: reference.id,
      authorId: reference.author.id,
      authorName: reference.author.tag,
    };
  } catch {
    return null;
  }
}

function getChannelName(message: Message): string {
  if ('name' in message.channel && typeof message.channel.name === 'string') {
    return message.channel.name;
  }

  if (message.guild) {
    return `channel-${message.channelId}`;
  }

  return `dm-${message.author.username}`;
}

async function notifyOwner(client: Client, config: Config, message: string): Promise<void> {
  try {
    if (config.ownerIds.length === 0) return;
    const user = await client.users.fetch(config.ownerIds[0]);
    await user.send(`⚠️ gemini-discord: ${message}`);
  } catch {
    // DM failed — error already logged elsewhere.
  }
}
