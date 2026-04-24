import * as fs from 'node:fs';
import * as path from 'node:path';
import { AttachmentBuilder, type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { log } from './log.js';
import { retrySend } from './retry.js';

export type SendableChannel = TextChannel | DMChannel | NewsChannel;

export async function sendDiscordMessage(
  channel: SendableChannel,
  content: string,
  chunkFn: (text: string) => string[],
  options: { replyTo?: Message; files?: string[] } = {},
): Promise<string[]> {
  const messageIds: string[] = [];
  const attachments: AttachmentBuilder[] = [];

  // Read files into attachments in parallel
  if (options.files && options.files.length > 0) {
    const filePromises = options.files.map(async (filePath) => {
      try {
        const buffer = await fs.promises.readFile(filePath);
        const fileName = path.basename(filePath);
        return new AttachmentBuilder(buffer, { name: fileName });
      } catch (err) {
        log.warn('Failed to read file for discord attachment', {
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });

    const results = await Promise.all(filePromises);
    for (const attachment of results) {
      if (attachment) attachments.push(attachment);
    }
  }

  const chunks = content && content.trim() ? chunkFn(content) : [];
  let replied = false;

  // Send content chunks
  if (chunks.length > 0) {
    for (const [index, chunk] of chunks.entries()) {
      if (index === 0 && options.replyTo) {
        const sent = await retrySend(() => options.replyTo!.reply(chunk));
        messageIds.push(sent.id);
        replied = true;
      } else {
        const sent = await retrySend(() => channel.send(chunk));
        messageIds.push(sent.id);
      }
    }
  }

  // Send attachments in batches of 10
  if (attachments.length > 0) {
    for (let index = 0; index < attachments.length; index += 10) {
      const batch = attachments.slice(index, index + 10);
      let sent;
      if (!replied && options.replyTo && index === 0 && chunks.length === 0) {
        sent = await retrySend(() => options.replyTo!.reply({ files: batch }));
        replied = true;
      } else {
        sent = await retrySend(() => channel.send({ files: batch }));
      }
      messageIds.push(sent.id);
    }
  }

  return messageIds;
}
