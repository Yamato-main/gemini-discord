import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import type { ConversationAttachment } from '../shared/types.js';
import { log } from './log.js';

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif']);
const DEFAULT_RETENTION_LIMITS = {
  maxMessageDirs: 250,
  maxBytes: 1024 * 1024 * 1024,
};

interface DiscordImageAttachment extends ConversationAttachment {
  url: string;
  id: string;
}

export interface DownloadedImageAttachment {
  localPath: string;
  relativePath: string;
  metadata: ConversationAttachment;
}

export interface AttachmentRetentionLimits {
  maxMessageDirs: number;
  maxBytes: number;
}

interface AttachmentDirectoryInfo {
  dirPath: string;
  mtimeMs: number;
  sizeBytes: number;
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

  const downloaded: DownloadedImageAttachment[] = [];

  for (const [index, attachment] of attachments.entries()) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const safeName = sanitizeFilename(attachment.name || `image-${index + 1}.bin`);
      const localPath = path.join(targetDir, `${index + 1}-${safeName}`);
      await fs.writeFile(localPath, buffer);
      const relativePath = path.relative(attachmentsRootDir, localPath);

      downloaded.push({
        localPath,
        relativePath,
        metadata: toConversationAttachment({
          ...attachment,
          sizeBytes: buffer.length,
        }),
      });
    } catch (err) {
      log.warn('Failed to download Discord image attachment', {
        messageId: message.id,
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (downloaded.length === 0) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    return downloaded;
  }

  await pruneAttachmentCache(attachmentsRootDir, [targetDir]);
  return downloaded;
}

export async function pruneAttachmentCache(
  attachmentsRootDir: string,
  preserveDirs: string[] = [],
  limits: AttachmentRetentionLimits = DEFAULT_RETENTION_LIMITS,
): Promise<void> {
  try {
    const dirEntries = await fs.readdir(attachmentsRootDir, { withFileTypes: true });
    const directories = await Promise.all(
      dirEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => getAttachmentDirectoryInfo(path.join(attachmentsRootDir, entry.name))),
    );

    let retainedDirCount = directories.length;
    let totalBytes = directories.reduce((sum, dir) => sum + dir.sizeBytes, 0);
    if (retainedDirCount <= limits.maxMessageDirs && totalBytes <= limits.maxBytes) {
      return;
    }

    const preserved = new Set(preserveDirs.map((dir) => path.resolve(dir)));
    const candidates = directories
      .filter((dir) => !preserved.has(path.resolve(dir.dirPath)))
      .sort((left, right) => left.mtimeMs - right.mtimeMs);

    let removedDirs = 0;
    for (const dir of candidates) {
      if (retainedDirCount <= limits.maxMessageDirs && totalBytes <= limits.maxBytes) {
        break;
      }

      await fs.rm(dir.dirPath, { recursive: true, force: true });
      retainedDirCount--;
      totalBytes -= dir.sizeBytes;
      removedDirs++;
    }

    if (removedDirs > 0) {
      log.info('Pruned Discord attachment cache', {
        attachmentsRootDir,
        removedDirs,
        retainedDirCount,
        totalBytes,
      });
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === 'ENOENT') {
      return;
    }

    log.warn('Failed to prune Discord attachment cache', {
      attachmentsRootDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

async function getAttachmentDirectoryInfo(dirPath: string): Promise<AttachmentDirectoryInfo> {
  const stats = await fs.stat(dirPath);
  return {
    dirPath,
    mtimeMs: stats.mtimeMs,
    sizeBytes: await getDirectorySize(dirPath),
  };
}

async function getDirectorySize(dirPath: string): Promise<number> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let totalBytes = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalBytes += await getDirectorySize(entryPath);
      continue;
    }

    const stats = await fs.stat(entryPath);
    totalBytes += stats.size;
  }

  return totalBytes;
}
