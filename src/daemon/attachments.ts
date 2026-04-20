import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import type { ConversationAttachment } from '../shared/types.js';
import { log } from './log.js';

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif']);

interface DiscordImageAttachment extends ConversationAttachment {
  url: string;
  id: string;
}

export interface DownloadedImageAttachment {
  localPath: string;
  relativePath: string;
  metadata: ConversationAttachment;
}

export function getImageAttachmentMetadata(message: Message): ConversationAttachment[] {
  return getImageAttachments(message).map(toConversationAttachment);
}

export async function downloadImageAttachments(
  message: Message,
  attachmentsRootDir: string,
): Promise<DownloadedImageAttachment[]> {
  const attachments = getImageAttachments(message);
  if (attachments.length === 0) {
    return [];
  }

  const targetDir = path.join(attachmentsRootDir, sanitizeFilename(message.id));
  await fs.mkdir(targetDir, { recursive: true });

  const downloads = attachments.map(async (attachment, index) => {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const safeName = sanitizeFilename(attachment.name || `image-${index + 1}.bin`);
      const localPath = path.join(targetDir, `${index + 1}-${safeName}`);
      await fs.writeFile(localPath, buffer);
      // relativePath is from bindingDir (Gemini CLI CWD), not attachmentsRootDir
      const bindingDir = path.dirname(attachmentsRootDir);
      const relativePath = path.relative(bindingDir, localPath);

      return {
        localPath,
        relativePath,
        metadata: toConversationAttachment({
          ...attachment,
          sizeBytes: buffer.length,
        }),
      };
    } catch (err) {
      log.warn('Failed to download Discord image attachment', {
        messageId: message.id,
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  });

  const results = await Promise.all(downloads);
  const downloaded: DownloadedImageAttachment[] = results.filter(
    (item): item is DownloadedImageAttachment => item !== null,
  );

  if (downloaded.length === 0) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  }

  return downloaded;
}



function getImageAttachments(message: Message): DiscordImageAttachment[] {
  return [...message.attachments.values()]
    .filter((attachment) => isImageAttachment(attachment.contentType ?? null, attachment.name ?? ''))
    .filter((attachment) => attachment.size <= MAX_IMAGE_BYTES)
    .slice(0, MAX_IMAGE_ATTACHMENTS)
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name ?? `image-${attachment.id}`,
      contentType: attachment.contentType ?? undefined,
      sizeBytes: attachment.size,
      url: attachment.url,
    }));
}

function isImageAttachment(contentType: string | null, name: string): boolean {
  if (contentType?.startsWith('image/')) {
    return true;
  }

  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function toConversationAttachment(attachment: DiscordImageAttachment): ConversationAttachment {
  return {
    name: attachment.name,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    url: attachment.url,
  };
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}


