/**
 * CLI engine — orchestrates message processing through Gemini CLI.
 *
 * Gemini CLI sessions are owned by the user's normal Gemini project context.
 * Discord bindings only keep session ids, metadata, and transient attachments.
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
import { downloadSupportedAttachments, getSupportedAttachmentMetadata } from './attachments.js';
import { type ToolMode } from './tool-mode.js';
import { processCrossChannelSends } from './channels.js';
import { sanitizeFullResponse } from './sanitizer.js';
import { getBackgroundOperationsContext } from './background-context.js';
import { runtimeStore } from './runtime.js';
import { log } from './log.js';
import { callGeminiStreaming } from './gemini.js';
import {
  authorizeAction,
  formatPermissionDenial,
  isBoss,
} from './permissions.js';
import {
  ensureGeminiBindingWorkspace,
  loadGeminiBindingState,
  recordGeminiBindingSession,
  resetGeminiBindingSession,
  resolveGeminiBindingKey,
} from './binding.js';
import {
  resolveBindingResumeSessionId,
  resolveGeminiProjectDir,
} from './gemini-project.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface ProcessingContext {
  sessionKey: string;
  bindingKey: string;
  bindingDir: string;
  attachmentsDir: string;
  geminiProjectDir: string;
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
  if (isBoss(accepted.roleContext) && message.attachments.size === 0 && message.reference?.messageId) {
    try {
      const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedTo && repliedTo.attachments.size > 0) {
        targetMessage = repliedTo;
      }
    } catch (e) {
      // Ignore fetch errors
    }
  }

  const attachmentMetadata = isBoss(accepted.roleContext) ? getSupportedAttachmentMetadata(targetMessage) : [];
  if ((targetMessage.attachments.size > 0 || attachmentMetadata.length > 0) && !isBoss(accepted.roleContext)) {
    const decision = authorizeAction('attachment_processing', accepted.roleContext);
    const responseText = formatPermissionDenial(decision);
    const messageIds = await sendPreparedDisplayText(channel, responseText);
    return { response: responseText, messageIds, attachments: [], sessionId: undefined };
  }

  const allowPersistentSession = isBoss(accepted.roleContext) && config.useGeminiCliSessions;
  const bindingState = loadGeminiBindingState(processingContext.bindingDir);
  const resumeSessionId = allowPersistentSession
    ? resolveBindingResumeSessionId(bindingState)
    : null;
  const downloadedAttachments = isBoss(accepted.roleContext)
    ? await downloadSupportedAttachments(
      targetMessage,
      processingContext.attachmentsDir,
      processingContext.geminiProjectDir,
    )
    : [];

  const incomingPrompt = {
    content: accepted.content,
    attachments: attachmentMetadata,
    speakerKind: accepted.speakerKind,
    authorId: message.author.id,
    authorName: message.author.tag,
    channelId: message.channelId,
    channelName: accepted.channelName,
    threadId: accepted.origin.threadId,
    guildId: message.guildId ?? null,
    guildName: accepted.guildName,
    messageId: message.id,
    replyToMessageId: accepted.replyToMessageId,
    replyToAuthorId: accepted.replyToAuthorId,
    replyToAuthorName: accepted.replyToAuthorName,
    replyToContent: accepted.replyToContent,
    replyToAttachments: accepted.replyToAttachments,
    trigger: accepted.trigger,
    roleContext: accepted.roleContext,
  } as const;

  // Session mode: The CLI IS the agent. Its own session file is the conversation.
  // Only send runtime context + current message. No history replay, no image URL
  // re-injection — the CLI session already has everything.
  //
  // Non-session mode: Full history replay with image URL grounding (fallback).
  let prompt: string;
  const backgroundContext = isBoss(accepted.roleContext)
    ? getBackgroundOperationsContext({
      channelId: message.channelId,
      channelName: accepted.channelName,
    })
    : undefined;

  if (allowPersistentSession) {
    prompt = buildSessionModePrompt({
      incoming: incomingPrompt,
      bossUserId: config.discordBossUserId,
      ownerIds: config.ownerIds,
      backgroundContext,
    });
  } else {
    const historySnapshot = memory.snapshot(processingContext.sessionKey);
    prompt = buildDiscordPrompt({
      history: historySnapshot,
      bossUserId: config.discordBossUserId,
      ownerIds: config.ownerIds,
      promptHistoryMessageLimit: config.promptHistoryMessageLimit,
      promptHistoryCharBudget: config.promptHistoryCharBudget,
      incoming: incomingPrompt,
      backgroundContext,
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
    const useHeadlessAttachmentPrompt = shouldUseHeadlessForAttachmentInjection(attachmentMetadata);
    const cliPool = runtimeStore.cliPool;
    if (!useHeadlessAttachmentPrompt && !cliPool) {
      throw new Error('CLI pool not initialized');
    }

    const sendViaCli = async (callbacks: { onToken: (token: string) => void; onThought: () => void }): Promise<string> => {
      const baseOptions = {
        cwd: processingContext.geminiProjectDir,
        useResume: useHeadlessAttachmentPrompt ? false : allowPersistentSession,
        resumeSessionId: useHeadlessAttachmentPrompt ? null : resumeSessionId,
        roleContext: accepted.roleContext,
        toolMode,
        attachmentPaths: downloadedAttachments.map((attachment) => attachment.relativePath),
        attachments: downloadedAttachments,
        onSessionId: (sessionId: string) => { currentSessionId = sessionId; },
      } as const;

      try {
        if (useHeadlessAttachmentPrompt) {
          log.info('Using fresh headless Gemini CLI prompt for attachment injection', {
            bindingKey: processingContext.bindingKey,
            attachmentCount: downloadedAttachments.length,
          });
          return await callGeminiStreaming(prompt, config, callbacks, baseOptions);
        }

        return await cliPool!.send(processingContext.bindingKey, prompt, callbacks, baseOptions);
      } catch (error) {
        if (!shouldRetryWithFreshSession(error, baseOptions.resumeSessionId)) {
          throw error;
        }

        log.warn('Gemini resume session crashed; retrying with a fresh session', {
          bindingKey: processingContext.bindingKey,
          sessionId: resumeSessionId,
          error: error instanceof Error ? error.message : String(error),
        });

        resetGeminiBindingSession(processingContext.bindingDir);
        currentSessionId = null;

        const freshOptions = {
          ...baseOptions,
          resumeSessionId: null,
        };

        if (useHeadlessAttachmentPrompt) {
          return callGeminiStreaming(prompt, config, callbacks, freshOptions);
        }

        return cliPool!.send(processingContext.bindingKey, prompt, callbacks, freshOptions);
      }
    };

    if (editor) {
      response = await sendViaCli(
        {
          onToken: (token) => editor.feed(token),
          onThought: () => editor.feedThought(),
        },
      );

      const prepared = await finalizeAssistantResponse(response, message, isBoss(accepted.roleContext));
      response = prepared.responseText;
      responseMessageIds = await editor.finalize(prepared.displayText, chunkMessage, {
        allowEmpty: prepared.allowEmpty,
        rawText: response,
      });
      responseMessageIds.push(...prepared.actionMessageIds);
      if (allowPersistentSession) {
        recordGeminiBindingSession(processingContext.bindingDir, currentSessionId ?? bindingState.lastSessionId);
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
        response = await sendViaCli(
          {
            onToken: () => {},
            onThought: () => {},
          },
        );
        clearInterval(typingInterval);

        const prepared = await finalizeAssistantResponse(response, message, isBoss(accepted.roleContext));
        response = prepared.responseText;
        responseMessageIds = await sendPreparedDisplayText(channel, prepared.displayText);
        responseMessageIds.push(...prepared.actionMessageIds);
        if (allowPersistentSession) {
          recordGeminiBindingSession(processingContext.bindingDir, currentSessionId ?? bindingState.lastSessionId);
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
  if (!isBoss(accepted.roleContext)) {
    const guestKey = message.guildId
      ? `guest:${message.author.id}:channel:${message.channelId}:message:${message.id}`
      : `guest:${message.author.id}:dm:${message.channelId}:message:${message.id}`;
    const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, guestKey);
    return {
      sessionKey: guestKey,
      bindingKey: guestKey,
      bindingDir: bindingWorkspace.bindingDir,
      attachmentsDir: bindingWorkspace.attachmentsDir,
      geminiProjectDir: resolveGeminiProjectDir(extensionDir),
    };
  }

  const bindingKey = resolveGeminiBindingKey('channel', {
    guildId: message.guildId ?? null,
    channelId: message.channelId,
    dmUserId: message.guildId ? null : message.author.id,
  });

  const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, bindingKey);
  const geminiProjectDir = resolveGeminiProjectDir(extensionDir);

  return {
    sessionKey: resolveSessionKey('channel', message.channelId, message.guildId ? null : message.author.id),
    bindingKey,
    bindingDir: bindingWorkspace.bindingDir,
    attachmentsDir: bindingWorkspace.attachmentsDir,
    geminiProjectDir,
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

function shouldRetryWithFreshSession(error: unknown, resumeSessionId: string | null): boolean {
  if (!resumeSessionId) {
    return false;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('exited with code')
    || message.includes('returned no assistant output')
    || message.includes('resume_session_unavailable');
}

export function shouldUseHeadlessForAttachmentInjection(attachments: ConversationAttachment[]): boolean {
  return false;
}
