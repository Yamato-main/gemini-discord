/**
 * CLI engine — orchestrates message processing through Gemini CLI.
 *
 * Gemini CLI sessions are project-scoped, so Discord conversations bind each
 * channel to a stable Gemini project workspace. That keeps session history and
 * image handling aligned with the direct CLI behavior.
 */

import { type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { type loadConfig } from '../shared/config.js';
import { chunkMessage } from '../shared/chunker.js';
import type { ConversationAttachment } from '../shared/types.js';
import type { AcceptedDiscordMessage } from './bot.js';
import { type ConversationMemory, buildDiscordPrompt, buildSessionModePrompt, resolveSessionKey } from './memory.js';
import { Semaphore } from './semaphore.js';
import { retrySend } from './retry.js';
import { LiveEditor } from './editor.js';
import { downloadImageAttachments, getImageAttachmentMetadata } from './attachments.js';
import { type ToolMode } from './tool-mode.js';
import { processCrossChannelSends } from './channels.js';
import { sanitizeFullResponse } from './sanitizer.js';
import { runtimeStore } from './runtime.js';
import {
  ensureGeminiBindingWorkspace,
  loadGeminiBindingState,
  resolveGeminiBindingKey,
  saveGeminiBindingState,
} from './binding.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface ProcessingContext {
  sessionKey: string;
  bindingKey: string;
  bindingDir: string;
  attachmentsDir: string;
}

export async function processViaCli(
  message: Message,
  accepted: AcceptedDiscordMessage,
  config: ReturnType<typeof loadConfig>,
  memory: ConversationMemory,
  processingContext: ProcessingContext,
  geminiSemaphore: Semaphore,
  channel: TextChannel | DMChannel | NewsChannel,
  toolMode: ToolMode,
): Promise<{ response: string; messageIds: string[]; attachments?: ConversationAttachment[]; sessionId?: string }> {
  let targetMessage = message;

  // If the current message has no attachments, but it's a reply to another message,
  // we should check the replied-to message for attachments to provide them as context.
  if (message.attachments.size === 0 && message.reference?.messageId) {
    try {
      const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedTo && repliedTo.attachments.size > 0) {
        targetMessage = repliedTo;
      }
    } catch (e) {
      // Ignore fetch errors
    }
  }

  const attachmentMetadata = getImageAttachmentMetadata(targetMessage);
  const bindingState = loadGeminiBindingState(processingContext.bindingDir);
  const resumeSessionId = config.useGeminiCliSessions
    ? (bindingState.lastSessionId ?? (bindingState.hasSession ? 'latest' : null))
    : null;
  const downloadedAttachments = await downloadImageAttachments(
    targetMessage,
    processingContext.attachmentsDir,
    processingContext.bindingDir,
  );

  const incomingPrompt = {
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
    replyToAuthorId: accepted.replyToAuthorId,
    replyToAuthorName: accepted.replyToAuthorName,
    trigger: accepted.trigger,
  } as const;

  // Session mode: The CLI IS the agent. Its own session file is the conversation.
  // Only send runtime context + current message. No history replay, no image URL
  // re-injection — the CLI session already has everything.
  //
  // Non-session mode: Full history replay with image URL grounding (fallback).
  let prompt: string;

  if (config.useGeminiCliSessions) {
    prompt = buildSessionModePrompt({
      incoming: incomingPrompt,
      bossUserId: config.discordBossId,
      ownerIds: config.ownerIds,
    });
  } else {
    const historySnapshot = memory.snapshot(processingContext.sessionKey);
    prompt = buildDiscordPrompt({
      history: historySnapshot,
      bossUserId: config.discordBossId,
      ownerIds: config.ownerIds,
      promptHistoryMessageLimit: config.promptHistoryMessageLimit,
      promptHistoryCharBudget: config.promptHistoryCharBudget,
      incoming: incomingPrompt,
    });
  }

  let response = '';
  let responseMessageIds: string[] = [];
  let currentSessionId: string | null = null;

  const editor = config.streaming ? new LiveEditor({ placeholderDelayMs: null }) : null;
  if (editor) await editor.init(channel);

  let feedbackMessageId: string | null = null;
  await geminiSemaphore.acquireWithTimeout(2000, () => {
    retrySend(() => channel.send('⏳ Gemini is busy processing other requests. Your turn is next...'))
      .then(msg => { feedbackMessageId = msg.id; })
      .catch(() => {});
  });

  try {
    if (!runtimeStore.cliPool) {
      throw new Error('CLI pool not initialized');
    }

    if (editor) {
      response = await runtimeStore.cliPool.send(
        processingContext.bindingKey,
        prompt,
        {
          onToken: (token) => editor.feed(token),
          onThought: () => editor.feedThought(),
        },
        {
          cwd: processingContext.bindingDir,
          resumeSessionId,
          isBoss: accepted.isBoss,
          toolMode,
          attachmentPaths: downloadedAttachments.map((attachment) => attachment.relativePath),
          onSessionId: (sessionId) => { currentSessionId = sessionId; },
        },
      );

      const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
      response = prepared.responseText;
      responseMessageIds = await editor.finalize(prepared.displayText, chunkMessage, {
        allowEmpty: prepared.allowEmpty,
        rawText: response,
      });
      responseMessageIds.push(...prepared.actionMessageIds);
      if (config.useGeminiCliSessions) {
        saveGeminiBindingState(processingContext.bindingDir, {
          hasSession: true,
          lastSessionId: currentSessionId ?? bindingState.lastSessionId,
        });
      }
      return {
        response,
        messageIds: responseMessageIds,
        attachments: attachmentMetadata,
        sessionId: currentSessionId ?? bindingState.lastSessionId ?? undefined,
      };
    } else {
      // Non-streaming fallback
      retrySend(() => channel.sendTyping()).catch(() => {});
      const typingInterval = setInterval(() => {
        retrySend(() => channel.sendTyping()).catch(() => {});
      }, 9000);

      try {
        response = await runtimeStore.cliPool.send(
          processingContext.bindingKey,
          prompt,
          {
            onToken: () => {},
            onThought: () => {},
          },
          {
            cwd: processingContext.bindingDir,
            resumeSessionId,
            isBoss: accepted.isBoss,
            toolMode,
            attachmentPaths: downloadedAttachments.map((attachment) => attachment.relativePath),
            onSessionId: (sessionId) => { currentSessionId = sessionId; },
          },
        );
        clearInterval(typingInterval);

        const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
        response = prepared.responseText;
        responseMessageIds = await sendPreparedDisplayText(channel, prepared.displayText);
        responseMessageIds.push(...prepared.actionMessageIds);
        if (config.useGeminiCliSessions) {
          saveGeminiBindingState(processingContext.bindingDir, {
            hasSession: true,
            lastSessionId: currentSessionId ?? bindingState.lastSessionId,
          });
        }
        return {
          response,
          messageIds: responseMessageIds,
          attachments: attachmentMetadata,
          sessionId: currentSessionId ?? bindingState.lastSessionId ?? undefined,
        };
      } catch (err) {
        clearInterval(typingInterval);
        throw err;
      }
    }
  } catch (err) {
    if (editor) await editor.sendError(formatError(err));
    else await retrySend(() => channel.send(formatError(err))).catch(() => {});
    return { response: '', messageIds: [], sessionId: currentSessionId ?? bindingState.lastSessionId ?? undefined };
  } finally {
    geminiSemaphore.release();
    if (feedbackMessageId) {
      channel.messages.delete(feedbackMessageId).catch(() => {});
    }
    // Clean up downloaded attachments and their directory
    if (downloadedAttachments.length > 0) {
      const targetDir = path.dirname(downloadedAttachments[0].localPath);
      for (const att of downloadedAttachments) {
        try {
          await fsp.unlink(att.localPath);
        } catch {}
      }
      try {
        await fsp.rm(targetDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

export interface FinalizedAssistantResponse {
  displayText: string;
  responseText: string;
  allowEmpty: boolean;
  actionMessageIds: string[];
}

export async function finalizeAssistantResponse(
  rawResponse: string,
  message: Message,
  allowPrivilegedActions: boolean,
): Promise<FinalizedAssistantResponse> {
  // 1. Strip CoT and internal thinking blocks early
  const sanitized = sanitizeFullResponse(rawResponse);

  // 2. Handle cross-channel send directives
  const actionResult = await processCrossChannelSends(sanitized, message.client, {
    allowPrivileged: allowPrivilegedActions,
  });

  return {
    displayText: actionResult.cleanedResponse,
    responseText: actionResult.cleanedResponse,
    allowEmpty: true,
    actionMessageIds: actionResult.messageIds,
  };
}

export async function sendPreparedDisplayText(
  channel: TextChannel | DMChannel | NewsChannel,
  displayText: string,
): Promise<string[]> {
  if (!displayText.trim()) {
    return [];
  }

  const messageIds: string[] = [];
  const chunks = chunkMessage(displayText);
  for (const chunk of chunks) {
    const sent = await retrySend(() => channel.send(chunk));
    messageIds.push(sent.id);
  }
  return messageIds;
}

export function resolveProcessingContext(
  config: ReturnType<typeof loadConfig>,
  message: Message,
  accepted: AcceptedDiscordMessage,
  extensionDir: string,
): ProcessingContext {
  const bindingKey = resolveGeminiBindingKey(config.geminiSessionBindingScope, {
    guildId: message.guildId ?? null,
    channelId: message.channelId,
  });

  const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, bindingKey);

  return {
    sessionKey: resolveSessionKey(config.memoryScope, message.channelId),
    bindingKey,
    bindingDir: bindingWorkspace.bindingDir,
    attachmentsDir: bindingWorkspace.attachmentsDir,
  };
}

export interface ErrorMatcher {
  match: (msg: string, err: unknown) => boolean;
  format: (msg: string) => string;
}

export const ERROR_MATCHERS: ErrorMatcher[] = [
  {
    match: (msg) => msg.includes('timed out') || msg.includes('stalled'),
    format: (msg) => msg.includes('stalled')
      ? 'Stalled — Gemini stopped producing output. Try a shorter question.'
      : 'Timeout — Gemini timed out. Try a shorter question.',
  },
  {
    match: (msg, err) => msg.includes('rate limit') || (err as { status?: number })?.status === 429,
    format: () => 'Rate Limited — Discord rate limit hit. Wait a moment and retry.',
  },
  {
    match: (msg) => msg.includes('exited with code'),
    format: (msg) => `Crash — ${msg.slice(0, 250)}`,
  },
  {
    match: (msg) => msg.includes('SIGTERM') || msg.includes('killed'),
    format: () => 'Crash — Gemini process was killed. Check daemon logs.',
  },
];

export function formatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  
  for (const matcher of ERROR_MATCHERS) {
    if (matcher.match(msg, err)) {
      return `**Error:** ${matcher.format(msg)}`;
    }
  }

  return `**Error:** ${msg.slice(0, 300)}`;
}
