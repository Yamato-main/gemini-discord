/**
 * CLI engine — orchestrates message processing through the CLI process pool.
 * 
 * Stripped of binding workspace overhead. Session identity tracked via
 * ConversationMemory session keys. Attachments handled in-memory or via
 * temp directory (no per-binding disk layout).
 */

import { type Message, type TextChannel, type DMChannel, type NewsChannel, type AttachmentBuilder } from 'discord.js';
import { type loadConfig } from '../shared/config.js';
import { chunkMessage } from '../shared/chunker.js';
import type { ConversationAttachment } from '../shared/types.js';
import type { AcceptedDiscordMessage } from './bot.js';
import { type ConversationMemory, buildDiscordPrompt, resolveSessionKey } from './memory.js';
import { Semaphore } from './semaphore.js';
import { retrySend } from './retry.js';
import { LiveEditor } from './editor.js';
import { downloadImageAttachments, getImageAttachmentMetadata } from './attachments.js';
import { type ToolMode } from './tool-mode.js';
import { processCrossChannelSends } from './channels.js';
import { prepareDiscordMessageContent, sendPreparedDiscordFiles } from './discord-media.js';
import { sanitizeFullResponse } from './sanitizer.js';
import { runtimeStore } from './runtime.js';
import { log } from './log.js';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ProcessingContext {
  sessionKey: string;
}

/** Shared temp directory for attachments (no per-binding dirs). */
let attachmentsTmpDir: string | null = null;

function getAttachmentsTmpDir(): string {
  if (!attachmentsTmpDir) {
    attachmentsTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-att-'));
  }
  return attachmentsTmpDir;
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
): Promise<{ response: string; messageIds: string[]; attachments?: ConversationAttachment[] }> {
  const attachmentMetadata = getImageAttachmentMetadata(message);

  // Download attachments to temp directory (cleaned up after response)
  const tmpDir = getAttachmentsTmpDir();
  const downloadedAttachments = await downloadImageAttachments(message, tmpDir);

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

  const prompt = buildDiscordPrompt({
    history: memory.snapshot(processingContext.sessionKey),
    bossUserId: config.discordBossId,
    promptHistoryMessageLimit: config.promptHistoryMessageLimit,
    promptHistoryCharBudget: config.promptHistoryCharBudget,
    incoming: incomingPrompt,
  });

  let response = '';
  let responseMessageIds: string[] = [];

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
        processingContext.sessionKey,
        prompt,
        {
          onToken: (token) => editor.feed(token),
          onThought: () => editor.feedThought(),
        },
        {
          isBoss: accepted.isBoss,
          toolMode,
          attachmentPaths: downloadedAttachments.map(a => a.relativePath),
        },
      );

      const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
      response = prepared.responseText;
      responseMessageIds = await editor.finalize(prepared.displayText, chunkMessage, {
        allowEmpty: prepared.allowEmpty,
        rawText: response,
      });
      responseMessageIds.push(
        ...await sendPreparedDiscordFiles(channel, prepared.files),
        ...prepared.actionMessageIds,
      );
      return { response, messageIds: responseMessageIds, attachments: prepared.attachments };
    } else {
      // Non-streaming fallback
      retrySend(() => channel.sendTyping()).catch(() => {});
      const typingInterval = setInterval(() => {
        retrySend(() => channel.sendTyping()).catch(() => {});
      }, 9000);

      try {
        response = await runtimeStore.cliPool.send(
          processingContext.sessionKey,
          prompt,
          {
            onToken: () => {},
            onThought: () => {},
          },
          {
            isBoss: accepted.isBoss,
            toolMode,
            attachmentPaths: downloadedAttachments.map(a => a.relativePath),
          },
        );
        clearInterval(typingInterval);

        const prepared = await finalizeAssistantResponse(response, message, accepted.isBoss);
        response = prepared.responseText;
        responseMessageIds = await sendPreparedDisplayText(channel, prepared.displayText);
        responseMessageIds.push(
          ...await sendPreparedDiscordFiles(channel, prepared.files),
          ...prepared.actionMessageIds,
        );
        return { response, messageIds: responseMessageIds, attachments: prepared.attachments };
      } catch (err) {
        clearInterval(typingInterval);
        throw err;
      }
    }
  } catch (err) {
    if (editor) await editor.sendError(formatError(err));
    else await retrySend(() => channel.send(formatError(err))).catch(() => {});
    return { response: '', messageIds: [] };
  } finally {
    geminiSemaphore.release();
    if (feedbackMessageId) {
      channel.messages.delete(feedbackMessageId).catch(() => {});
    }
    // Clean up downloaded attachments
    for (const att of downloadedAttachments) {
      try {
        const fullPath = path.isAbsolute(att.relativePath) ? att.relativePath : path.join(tmpDir, att.relativePath);
        fs.unlinkSync(fullPath);
      } catch {}
    }
  }
}

export interface FinalizedAssistantResponse {
  displayText: string;
  responseText: string;
  allowEmpty: boolean;
  files: AttachmentBuilder[];
  attachments: ConversationAttachment[];
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

  // 3. Extract and verify image attachments
  const prepared = await prepareDiscordMessageContent(actionResult.cleanedResponse);

  const imageMarker = prepared.files.length > 0
    ? `[sent ${prepared.files.length} image attachment${prepared.files.length === 1 ? '' : 's'}]`
    : '';

  const responseTextForMemory = prepared.text;
  const displayText = prepared.text || imageMarker;

  return {
    displayText,
    responseText: responseTextForMemory,
    allowEmpty: prepared.files.length > 0,
    files: prepared.files,
    attachments: prepared.attachments,
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
): ProcessingContext {
  return {
    sessionKey: resolveSessionKey(config.memoryScope, message.channelId),
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
