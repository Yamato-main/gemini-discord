import { type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { createClient, setupReconnectHandlers, setupMessageHandler, type AcceptedDiscordMessage } from './bot.js';
import { type DaemonState } from './api.js';
import { type ConversationMemory, resolveSessionKey } from './memory.js';
import { type ChannelQueue } from './queue.js';
import { log } from './log.js';
import { registerGuildCommands, setupInteractionHandler } from './commands.js';
import { buildGuildChannelMap } from './channels.js';
import { processViaCli, resolveProcessingContext, formatError, type ProcessingContext } from './engine-cli.js';
import { retrySend } from './retry.js';
import { resolveToolMode } from './tool-mode.js';
import { getImageAttachmentMetadata } from './attachments.js';
import { type loadConfig } from '../shared/config.js';
import { runtimeStore } from './runtime.js';
import { type Semaphore } from './semaphore.js';
import type { ExchangeLog } from '../shared/types.js';
import { initCron } from './cron.js';
import { resetConversationSession } from './session-reset.js';
import { ensureOwnerDmPairings, touchDmPairing } from './dm-pairing.js';

const MAX_AGENT_EXCHANGES = 6;

export async function initGateway(
  config: ReturnType<typeof loadConfig>,
  state: DaemonState,
  memory: ConversationMemory,
  queue: ChannelQueue,
  apiServer: any,
  extensionDir: string
): Promise<void> {
  const client = createClient(config);
  runtimeStore.client = client;

  setupInteractionHandler(client, config, state, memory, extensionDir);

  setupReconnectHandlers(client, config, (status) => {
    state.status = status;
  });

  client.once('clientReady', async () => {
    log.info('Discord bot connected', { tag: client.user?.tag });

    try {
      const channel = await client.channels.fetch(config.discordChannelId);
      if (!channel) {
        log.error('Could not find configured primary channel', { channelId: config.discordChannelId });
        process.exit(1);
      }
      log.info('Primary channel access verified', { channelId: config.discordChannelId });
    } catch (err) {
      log.error('Failed to access configured primary channel', {
        channelId: config.discordChannelId,
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }

    await buildGuildChannelMap(client);

    if (state.status !== 'degraded') {
      state.status = 'ready';
    }
    log.info('Daemon ready', { status: state.status });

    initCron(config, client, extensionDir);
    await ensureOwnerDmPairings(client, config, extensionDir);

    await registerGuildCommands(client, config);
  });

  setupMessageHandler(client, config, {
    onMessage: (message: Message, accepted: AcceptedDiscordMessage) => {
      runtimeStore.lastInteractiveMessageAt = Date.now();
      if (!message.guildId) {
        touchDmPairing(extensionDir, message.author.id, message.channelId);
      }
      const processingContext = resolveProcessingContext(config, message, accepted, extensionDir);
      const chan = message.channel as TextChannel | DMChannel | NewsChannel;

      if (isResetCommand(message.content, accepted.content, config.discordResetCmd, config.discordPrefix)) {
        resetConversationSession(config, memory, extensionDir, {
          channelId: message.channelId,
          guildId: message.guildId ?? null,
          authorId: message.guildId ? null : message.author.id,
        });
        retrySend(() => chan.send('🧹 Conversation cleared.')).catch(() => {});
        return;
      }

      if (accepted.speakerKind === 'agent') {
        const count = runtimeStore.agentExchangeCount.get(message.channelId) ?? 0;
        if (count >= MAX_AGENT_EXCHANGES) {
          log.info('Agent exchange limit reached — pausing bot-to-bot', {
            channelId: message.channelId,
            count,
          });
          retrySend(() => chan.send(
            `⏸️ **Paused** — Reached ${MAX_AGENT_EXCHANGES} agent exchange rounds. Send a message to resume.`,
          )).catch(() => {});
          return;
        }
      } else {
        runtimeStore.agentExchangeCount.set(message.channelId, 0);
      }

      const queueKeys = [
        `binding:${processingContext.bindingKey}`,
        `memory:${processingContext.sessionKey}`,
      ];
      const enqueued = runtimeStore.queue?.enqueue(queueKeys, async () => {
        await processMessage(
          message,
          accepted,
          config,
          memory,
          state,
          processingContext,
          runtimeStore.geminiSemaphore!,
        );
      }) ?? false;

      if (!enqueued) {
        retrySend(() => chan.send('⏳ Too many pending messages for this conversation. Please wait a moment and retry.'))
          .catch(() => {});
      }
    },
    onIgnoredMessage: (message: Message, trackOnlyContext) => {
      const sessionKey = resolveSessionKey(config.memoryScope, message.channelId, message.guildId ? null : message.author.id);
      const attachmentMetadata = getImageAttachmentMetadata(message);
      
      memory.add(sessionKey, {
        role: 'user',
        content: trackOnlyContext.content,
        attachments: attachmentMetadata,
        speakerKind: trackOnlyContext.speakerKind,
        authorId: message.author.id,
        authorName: message.author.tag,
        channelId: message.channelId,
        channelName: trackOnlyContext.channelName,
        guildId: message.guildId ?? null,
        guildName: trackOnlyContext.guildName,
        messageId: message.id,
        replyToMessageId: trackOnlyContext.replyToMessageId,
        replyToAuthorId: trackOnlyContext.replyToAuthorId,
        replyToAuthorName: trackOnlyContext.replyToAuthorName,
        trigger: 'tracked',
        createdAt: new Date().toISOString(),
      });
      
      log.debug('Tracked ignored message for context', {
        author: message.author.tag,
        channelId: message.channelId,
        sessionKey,
      });
    },
  }, () => runtimeStore.isShuttingDown);

  await client.login(config.discordBotToken);
  log.info('Discord login initiated');
}

function isResetCommand(
  rawContent: string,
  normalizedContent: string,
  resetCommand: string,
  prefix: string,
): boolean {
  const raw = rawContent.trim();
  if (raw === resetCommand || normalizedContent === resetCommand) {
    return true;
  }

  if (prefix && resetCommand.startsWith(prefix)) {
    return normalizedContent === resetCommand.slice(prefix.length).trim();
  }

  return false;
}

async function processMessage(
  message: Message,
  accepted: AcceptedDiscordMessage,
  config: ReturnType<typeof loadConfig>,
  memory: ConversationMemory,
  state: DaemonState,
  processingContext: ProcessingContext,
  geminiSemaphore: Semaphore,
): Promise<void> {
  const channel = message.channel as TextChannel | DMChannel | NewsChannel;
  const startTime = Date.now();
  const toolMode = accepted.trigger === 'cron' ? 'discord' : resolveToolMode(accepted.content);
  const attachmentMetadata = getImageAttachmentMetadata(message);
  let effectiveAttachmentMetadata = attachmentMetadata;

  let response = '';
  let responseMessageIds: string[] = [];
  let geminiSessionId: string | undefined;

  try {
    if (!accepted.content.trim() && message.attachments.size > 0 && attachmentMetadata.length === 0) {
      await retrySend(() =>
        channel.send('🖼️ I can inspect Discord image attachments, but I could not read any supported image from that message.'),
      ).catch(() => {});
      return;
    }

    const result = await processViaCli(
      message, accepted, config, memory, processingContext, geminiSemaphore, channel, toolMode,
    );
    response = result.response;
    responseMessageIds = result.messageIds;
    effectiveAttachmentMetadata = result.attachments ?? attachmentMetadata;
    geminiSessionId = result.sessionId;

    await persistExchange();

    if (accepted.speakerKind === 'agent') {
      const prev = runtimeStore.agentExchangeCount.get(message.channelId) ?? 0;
      runtimeStore.agentExchangeCount.set(message.channelId, prev + 1);
    }
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    const errorMsg = formatError(err);
    await retrySend(() => channel.send(errorMsg)).catch(() => {});
    log.error('Message processing failed', {
      channelId: message.channelId,
      error: state.lastError,
      sessionKey: processingContext.sessionKey,
      toolMode,
    });
  }

  async function persistExchange(): Promise<void> {
    const now = new Date().toISOString();

    memory.add(processingContext.sessionKey, {
      role: 'user',
      content: accepted.content,
      attachments: effectiveAttachmentMetadata,
      speakerKind: accepted.speakerKind,
      authorId: message.author.id,
      authorName: message.author.tag,
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      messageId: message.id,
      replyToMessageId: accepted.replyToMessageId,
      replyToAuthorId: accepted.replyToAuthorId,
      replyToAuthorName: accepted.replyToAuthorName,
      trigger: `${accepted.trigger}:${processingContext.sessionKey}`,
      createdAt: now,
    });

    memory.add(processingContext.sessionKey, {
      role: 'assistant',
      content: response,
      speakerKind: 'assistant',
      authorId: message.client.user?.id,
      authorName: message.client.user?.tag ?? 'Assistant',
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      messageId: responseMessageIds[0],
      replyToMessageId: message.id,
      replyToAuthorId: message.author.id,
      replyToAuthorName: message.author.tag,
      trigger: `${accepted.trigger}:${processingContext.sessionKey}`,
      createdAt: now,
    });

    const elapsed = Date.now() - startTime;
    state.messagesHandled++;
    state.lastMessageAt = new Date().toISOString();

    const logEntry: ExchangeLog = {
      at: now,
      author: message.author.tag,
      authorId: message.author.id,
      authorType: accepted.speakerKind,
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      requestMessageId: message.id,
      responseMessageIds,
      attachmentCount: effectiveAttachmentMetadata.length,
      trigger: `${accepted.trigger}:${processingContext.sessionKey}`,
      prompt: (accepted.content || (effectiveAttachmentMetadata.length > 0 ? '[image-only message]' : '')).slice(0, 500),
      response: response.slice(0, 500),
      elapsedMs: elapsed,
    };
    state.exchangeLog.push(logEntry);

    if (state.exchangeLog.length > 100) {
      state.exchangeLog = state.exchangeLog.slice(-100);
    }

    log.info('Message processed', {
      author: message.author.tag,
      channelId: message.channelId,
      sessionKey: processingContext.sessionKey,
      elapsedMs: elapsed,
      responseMessages: responseMessageIds.length,
      attachmentCount: attachmentMetadata.length,
      toolMode,
      geminiSessionId,
    });
  }
}
