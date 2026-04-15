/**
 * Daemon entry point (Track 1).
 * Startup sequence: preflight → config → memory → queue → HTTP API → Discord bot.
 */

import type { Message, TextBasedChannel } from 'discord.js';
import { loadConfig, resolveExtensionDir } from './shared/config.js';
import { chunkMessage } from './shared/chunker.js';
import type { ExchangeLog } from './shared/types.js';
import { runPreflight } from './daemon/preflight.js';
import { createClient, setupReconnectHandlers, setupMessageHandler, type AcceptedDiscordMessage } from './daemon/bot.js';
import { buildDiscordPrompt, ConversationMemory, resolveSessionKey } from './daemon/memory.js';
import { ChannelQueue } from './daemon/queue.js';
import { startControlApi, type DaemonState } from './daemon/api.js';
import { withRetry, sleep } from './daemon/retry.js';
import { log } from './daemon/log.js';
import { LiveEditor } from './daemon/editor.js';
import { callGeminiStreaming, callGeminiFull } from './daemon/gemini.js';
import { downloadImageAttachments, getImageAttachmentMetadata } from './daemon/attachments.js';
import {
  ensureGeminiBindingWorkspace,
  loadBindingState,
  resolveGeminiBindingKey,
  saveBindingState,
} from './daemon/binding.js';

const extensionDir = resolveExtensionDir(__dirname);

let shuttingDown = false;

interface ProcessingContext {
  sessionKey: string;
  bindingKey: string;
}

const state: DaemonState = {
  status: 'starting',
  startedAt: new Date().toISOString(),
  geminiReachable: false,
  geminiVersion: 'unknown',
  messagesHandled: 0,
  lastMessageAt: null,
  lastError: null,
  exchangeLog: [],
};

async function main(): Promise<void> {
  log.info('gemini-discord daemon starting', { dir: extensionDir });

  const preflight = await runPreflight(extensionDir);
  state.geminiReachable = preflight.geminiReachable;
  state.geminiVersion = preflight.geminiVersion;

  if (!preflight.geminiReachable) {
    state.status = 'degraded';
  }

  const config = loadConfig(extensionDir);
  log.info('Config loaded', {
    channelId: config.discordChannelId,
    owners: config.ownerIds.length,
    allowlistedUsers: config.allowedUserIds.length,
    allowlistedAgents: config.allowedAgentIds.length,
    streaming: config.streaming,
    enableDMs: config.enableDMs,
    memoryScope: config.memoryScope,
    geminiSessionBindingScope: config.geminiSessionBindingScope,
    useGeminiCliSessions: config.useGeminiCliSessions,
    port: config.daemonPort,
    model: config.geminiModel,
  });

  const memory = new ConversationMemory(extensionDir, config.conversationHistoryLength);
  memory.startAutoFlush();
  log.info('Conversation memory initialized', { sessions: memory.sessions().length });

  const queue = new ChannelQueue(config.queueMaxDepth);
  const client = createClient(config);

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal });

    await Promise.race([queue.drainAll(), sleep(30_000)]);
    memory.stopAutoFlush();

    client.destroy();
    if (apiServer) {
      apiServer.close(() => {
        log.info('Shutdown complete');
        process.exit(0);
      });
    } else {
      log.info('Shutdown complete (no API server)');
      process.exit(0);
    }

    setTimeout(() => {
      log.error('Forced exit — shutdown timed out');
      process.exit(1);
    }, 35_000);
  }

  const apiServer = startControlApi({
    config,
    state,
    memory,
    queue,
    client,
    isShuttingDown: () => shuttingDown,
    shutdown,
  });

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

    if (state.status !== 'degraded') {
      state.status = 'ready';
    }
    log.info('Daemon ready', { status: state.status });
  });

  setupMessageHandler(client, config, {
    onMessage: (message: Message, accepted: AcceptedDiscordMessage) => {
      const processingContext = resolveProcessingContext(config, message, accepted);

      if (isResetCommand(message.content, accepted.content, config.discordResetCmd, config.discordPrefix)) {
        memory.reset(processingContext.sessionKey);
        withRetry(() => message.channel.send('🧹 Conversation cleared.')).catch(() => {});
        return;
      }

      const queueKeys = [processingContext.sessionKey, processingContext.bindingKey];
      const acceptedIntoQueue = queue.enqueue(queueKeys, () =>
        processMessage(message, accepted, config, memory, state, processingContext),
      );

      if (!acceptedIntoQueue) {
        const depth = queue.depth(queueKeys);
        withRetry(() =>
          message.channel.send(`⚠️ Queue full (${depth} pending). Try again in ~30s.`),
        ).catch(() => {});
      }
    },
  }, () => shuttingDown);

  await client.login(config.discordBotToken);
  log.info('Discord login initiated');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function processMessage(
  message: Message,
  accepted: AcceptedDiscordMessage,
  config: ReturnType<typeof loadConfig>,
  memory: ConversationMemory,
  state: DaemonState,
  processingContext: ProcessingContext,
): Promise<void> {
  const channel = message.channel as TextBasedChannel;
  const startTime = Date.now();
  const attachmentMetadata = getImageAttachmentMetadata(message);
  const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, processingContext.bindingKey);
  const bindingState = loadBindingState(bindingWorkspace.bindingDir);
  const downloadedAttachments = await downloadImageAttachments(message, bindingWorkspace.attachmentsDir);
  const prompt = buildDiscordPrompt({
    bindingKey: config.useGeminiCliSessions ? processingContext.bindingKey : undefined,
    history: config.useGeminiCliSessions ? undefined : memory.snapshot(processingContext.sessionKey),
    incoming: {
      content: accepted.content,
      attachments: attachmentMetadata,
      speakerKind: accepted.speakerKind,
      authorId: message.author.id,
      authorName: message.author.tag,
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      messageId: message.id,
      replyToMessageId: accepted.replyToMessageId,
      trigger: accepted.trigger,
    },
  });

  let response = '';
  let responseMessageIds: string[] = [];
  let activeSessionId = bindingState.lastSessionId;

  try {
    if (!accepted.content.trim() && message.attachments.size > 0 && downloadedAttachments.length === 0) {
      await withRetry(() =>
        channel.send('🖼️ I can inspect Discord image attachments, but I could not read any supported image from that message.'),
      ).catch(() => {});
      return;
    }

    if (config.streaming) {
      const editor = new LiveEditor();
      await editor.init(channel);

      try {
        response = await runGeminiStreamingAttempt(config, prompt, bindingWorkspace.bindingDir, downloadedAttachments.map((attachment) => attachment.relativePath), bindingState.hasSession, (sessionId) => {
          activeSessionId = sessionId;
        }, editor);
        responseMessageIds = await editor.finalize(response, chunkMessage);
      } catch (err) {
        await editor.sendError(formatError(err));
        return;
      }
    } else {
      withRetry(() => channel.sendTyping()).catch(() => {});

      try {
        response = await runGeminiFullAttempt(config, prompt, bindingWorkspace.bindingDir, downloadedAttachments.map((attachment) => attachment.relativePath), bindingState.hasSession, (sessionId) => {
          activeSessionId = sessionId;
        });
        const chunks = chunkMessage(response);
        for (const chunk of chunks) {
          const sent = await withRetry(() => channel.send(chunk));
          responseMessageIds.push(sent.id);
        }
      } catch (err) {
        await withRetry(() => channel.send(formatError(err))).catch(() => {});
        return;
      }
    }

    saveBindingState(bindingWorkspace.bindingDir, {
      hasSession: config.useGeminiCliSessions,
      lastSessionId: config.useGeminiCliSessions ? activeSessionId : undefined,
    });

    await persistExchange();
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    const errorMsg = formatError(err);
    await withRetry(() => channel.send(errorMsg)).catch(() => {});
    log.error('Message processing failed', {
      channelId: message.channelId,
      error: state.lastError,
      bindingKey: processingContext.bindingKey,
    });
  }

  async function persistExchange(): Promise<void> {
    const now = new Date().toISOString();

    memory.add(processingContext.sessionKey, {
      role: 'user',
      content: accepted.content,
      attachments: attachmentMetadata,
      speakerKind: accepted.speakerKind,
      authorId: message.author.id,
      authorName: message.author.tag,
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      messageId: message.id,
      replyToMessageId: accepted.replyToMessageId,
      trigger: `${accepted.trigger}:${processingContext.bindingKey}`,
      createdAt: now,
    });

    memory.add(processingContext.sessionKey, {
      role: 'assistant',
      content: response,
      speakerKind: 'assistant',
      authorId: message.client.user?.id,
      authorName: message.client.user?.tag ?? 'Yamato-samurai',
      channelId: message.channelId,
      channelName: accepted.channelName,
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      messageId: responseMessageIds[0],
      replyToMessageId: message.id,
      trigger: `${accepted.trigger}:${processingContext.bindingKey}`,
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
      attachmentCount: attachmentMetadata.length,
      trigger: `${accepted.trigger}:${processingContext.bindingKey}`,
      prompt: (accepted.content || (attachmentMetadata.length > 0 ? '[image-only message]' : '')).slice(0, 500),
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
      bindingKey: processingContext.bindingKey,
      elapsedMs: elapsed,
      responseMessages: responseMessageIds.length,
      attachmentCount: attachmentMetadata.length,
    });
  }
}

async function runGeminiStreamingAttempt(
  config: ReturnType<typeof loadConfig>,
  prompt: string,
  cwd: string,
  attachmentPaths: string[],
  hasSession: boolean,
  onSessionId: (sessionId: string) => void,
  editor: LiveEditor,
): Promise<string> {
  try {
    return await callGeminiStreaming(prompt, config, {
      onToken: (token) => editor.feed(token),
    }, {
      cwd,
      useResume: config.useGeminiCliSessions && hasSession,
      attachmentPaths,
      onSessionId,
    });
  } catch (err) {
    if (shouldRetryWithoutResume(err, config.useGeminiCliSessions && hasSession)) {
      return callGeminiStreaming(prompt, config, {
        onToken: (token) => editor.feed(token),
      }, {
        cwd,
        useResume: false,
        attachmentPaths,
        onSessionId,
      });
    }
    throw err;
  }
}

async function runGeminiFullAttempt(
  config: ReturnType<typeof loadConfig>,
  prompt: string,
  cwd: string,
  attachmentPaths: string[],
  hasSession: boolean,
  onSessionId: (sessionId: string) => void,
): Promise<string> {
  try {
    return await callGeminiFull(prompt, config, {
      cwd,
      useResume: config.useGeminiCliSessions && hasSession,
      attachmentPaths,
      onSessionId,
    });
  } catch (err) {
    if (shouldRetryWithoutResume(err, config.useGeminiCliSessions && hasSession)) {
      return callGeminiFull(prompt, config, {
        cwd,
        useResume: false,
        attachmentPaths,
        onSessionId,
      });
    }
    throw err;
  }
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

function resolveProcessingContext(
  config: ReturnType<typeof loadConfig>,
  message: Message,
  accepted: AcceptedDiscordMessage,
): ProcessingContext {
  return {
    sessionKey: resolveSessionKey(config.memoryScope, message.channelId),
    bindingKey: resolveGeminiBindingKey(config.geminiSessionBindingScope, {
      guildId: message.guildId ?? null,
      guildName: accepted.guildName,
      channelId: message.channelId,
      channelName: accepted.channelName,
      authorId: message.author.id,
    }),
  };
}

function shouldRetryWithoutResume(err: unknown, attemptedResume: boolean): boolean {
  if (!attemptedResume) {
    return false;
  }

  const message = err instanceof Error ? err.message : String(err);
  return message.includes('resume_session_unavailable');
}

function formatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('timed out')) {
    return '⏱️ **Timeout** — Gemini timed out. Try a shorter question.';
  }
  if (msg.includes('rate limit') || (err as { status?: number })?.status === 429) {
    return '🛑 **Rate Limited** — Discord rate limit hit. Wait a moment and retry.';
  }
  if (msg.includes('resume_session_unavailable')) {
    return '⚠️ **Session Reset** — The saved Gemini session was unavailable, so I need a fresh turn. Retry once.';
  }
  if (msg.includes('exited with code')) {
    return `💥 **Crash** — ${msg.slice(0, 250)}`;
  }
  if (msg.includes('SIGTERM') || msg.includes('killed')) {
    return '💥 **Crash** — Gemini process was killed. Check daemon logs.';
  }
  return `⚠️ **Error** — ${msg.slice(0, 300)}`;
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
