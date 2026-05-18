import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { AttachmentBuilder, MessageFlags, type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { retrySend } from './retry.js';

export type SendableChannel = TextChannel | DMChannel | NewsChannel;

export async function sendDiscordMessage(
  channel: SendableChannel,
  content: string,
  chunkFn: (text: string) => string[],
  options: { replyTo?: Message; files?: string[]; silent?: boolean } = {},
): Promise<string[]> {
  const messageIds: string[] = [];
  const attachments = await buildAttachments(options.files);
  const chunks = content && content.trim() ? chunkFn(content) : [];
  let replied = false;
  const silentFlags = options.silent
    ? { flags: [MessageFlags.SuppressNotifications] as const }
    : {};

  if (attachments.length > 0) {
    const [firstChunk, ...remainingChunks] = chunks;

    // Send the first caption with the first attachment batch so a failed file
    // upload cannot leave behind a text-only "sent" claim.
    for (let index = 0; index < attachments.length; index += 10) {
      const batch = attachments.slice(index, index + 10);
      const payload = firstChunk && index === 0
        ? { content: firstChunk, files: batch, ...silentFlags }
        : { files: batch, ...silentFlags };
      let sent;
      if (!replied && options.replyTo && index === 0) {
        sent = await retrySend(() => options.replyTo!.reply(payload));
        replied = true;
      } else {
        sent = await retrySend(() => channel.send(payload));
      }
      messageIds.push(sent.id);
    }

    for (const chunk of remainingChunks) {
      const sent = await retrySend(() => channel.send({ content: chunk, ...silentFlags }));
      messageIds.push(sent.id);
    }

    return messageIds;
  }

  // Send content chunks
  if (chunks.length > 0) {
    for (const [index, chunk] of chunks.entries()) {
      if (index === 0 && options.replyTo) {
        const sent = await retrySend(() => options.replyTo!.reply({ content: chunk, ...silentFlags }));
        messageIds.push(sent.id);
        replied = true;
      } else {
        const sent = await retrySend(() => channel.send({ content: chunk, ...silentFlags }));
        messageIds.push(sent.id);
      }
    }
  }

  return messageIds;
}

async function buildAttachments(files?: string[]): Promise<AttachmentBuilder[]> {
  if (!files || files.length === 0) {
    return [];
  }

  return Promise.all(files.map(async (filePath) => {
    let stat;
    try {
      stat = await fsp.stat(filePath);
      await fsp.access(filePath, fs.constants.R_OK);
    } catch (err) {
      throw new Error(`Attachment file is not readable: ${filePath} (${err instanceof Error ? err.message : String(err)})`);
    }

    if (!stat.isFile()) {
      throw new Error(`Attachment path is not a file: ${filePath}`);
    }

    return new AttachmentBuilder(filePath, { name: path.basename(filePath) });
  }));
}
