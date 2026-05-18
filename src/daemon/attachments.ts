import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Attachment, Message } from 'discord.js';
import type { ConversationAttachment } from '../shared/types.js';
import { log } from './log.js';

const MAX_SUPPORTED_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mpeg', '.mpg', '.avi', '.wmv', '.flv', '.3gp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.aiff', '.aif']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.log',
  '.ini',
]);

export type SupportedAttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

interface DiscordSupportedAttachment extends ConversationAttachment {
  url: string;
  id: string;
  kind: SupportedAttachmentKind;
}

export interface DownloadedAttachment {
  localPath: string;
  relativePath: string;
  metadata: ConversationAttachment;
  kind: SupportedAttachmentKind;
  inlineData?: {
    data: string;
    mimeType: string;
  };
}

export type DownloadedImageAttachment = DownloadedAttachment;

export function getSupportedAttachmentMetadata(message: Message): ConversationAttachment[] {
  return getSupportedAttachments(message).map(toConversationAttachment);
}

export async function downloadSupportedAttachments(
  message: Message,
  attachmentsRootDir: string,
  geminiProjectDir: string = attachmentsRootDir,
): Promise<DownloadedAttachment[]> {
  const attachments = getSupportedAttachments(message);
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
      const safeName = sanitizeFilename(attachment.name || `${attachment.kind}-${index + 1}.bin`);
      const localPath = path.join(targetDir, `${index + 1}-${safeName}`);
      await fs.writeFile(localPath, buffer);
      const relativePath = path.relative(geminiProjectDir, localPath);
      const metadata = toConversationAttachment({
        ...attachment,
        sizeBytes: buffer.length,
      });
      const inlineData = buildInlineData(attachment, buffer);

      return {
        localPath,
        relativePath,
        metadata,
        kind: attachment.kind,
        ...(inlineData ? { inlineData } : {}),
      };
    } catch (err) {
      log.warn('Failed to download Discord attachment', {
        messageId: message.id,
        attachmentId: attachment.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  });

  const results = await Promise.all(downloads);
  const downloaded: DownloadedAttachment[] = results.filter(
    (item): item is DownloadedAttachment => item !== null,
  );

  if (downloaded.length === 0) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  }

  return downloaded;
}

export const getImageAttachmentMetadata = getSupportedAttachmentMetadata;
export const downloadImageAttachments = downloadSupportedAttachments;

function getSupportedAttachments(message: Message): DiscordSupportedAttachment[] {
  return [...message.attachments.values()]
    .flatMap((attachment): Array<{ attachment: Attachment; kind: SupportedAttachmentKind }> => {
      const kind = classifySupportedAttachment(attachment.contentType ?? null, attachment.name ?? '');
      return kind
        ? [{
            attachment,
            kind,
          }]
        : [];
    })
    .filter(({ attachment, kind }) => attachment.size <= maxBytesForKind(kind))
    .slice(0, MAX_SUPPORTED_ATTACHMENTS)
    .map(({ attachment, kind }) => ({
      id: attachment.id,
      name: attachment.name ?? `${kind}-${attachment.id}`,
      contentType: attachment.contentType ?? undefined,
      sizeBytes: attachment.size,
      url: attachment.url,
      kind,
    }));
}

function classifySupportedAttachment(contentType: string | null, name: string): SupportedAttachmentKind | null {
  if (contentType) {
    const baseType = normalizeContentType(contentType);
    if (baseType.startsWith('image/')) return 'image';
    if (baseType.startsWith('video/')) return 'video';
    if (baseType.startsWith('audio/')) return 'audio';
    if (baseType.startsWith('text/')) return 'text';
    if (baseType === 'application/pdf') return 'pdf';
    if (isTextLikeApplicationType(baseType)) return 'text';
  }

  const extension = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';

  return null;
}

function isTextLikeApplicationType(contentType: string): boolean {
  return (
    contentType === 'application/json' ||
    contentType === 'application/ld+json' ||
    contentType === 'application/x-ndjson' ||
    contentType === 'application/xml' ||
    contentType === 'application/yaml' ||
    contentType === 'application/x-yaml' ||
    contentType === 'application/toml' ||
    contentType === 'application/javascript' ||
    contentType === 'application/typescript' ||
    contentType === 'application/x-sh'
  );
}

function normalizeContentType(contentType: string): string {
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

function maxBytesForKind(kind: SupportedAttachmentKind): number {
  switch (kind) {
    case 'image':
      return MAX_IMAGE_BYTES;
    case 'video':
      return MAX_VIDEO_BYTES;
    case 'audio':
      return MAX_AUDIO_BYTES;
    case 'pdf':
      return MAX_PDF_BYTES;
    case 'text':
      return MAX_TEXT_BYTES;
  }
}

function buildInlineData(
  attachment: DiscordSupportedAttachment,
  buffer: Buffer,
): DownloadedAttachment['inlineData'] | undefined {
  if (attachment.kind === 'text' || buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
    return undefined;
  }

  return {
    data: buffer.toString('base64'),
    mimeType: resolveAttachmentMimeType(attachment),
  };
}

function resolveAttachmentMimeType(attachment: DiscordSupportedAttachment): string {
  if (attachment.contentType) {
    return normalizeContentType(attachment.contentType);
  }

  const extension = path.extname(attachment.name).toLowerCase();
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.flac':
      return 'audio/flac';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function toConversationAttachment(attachment: DiscordSupportedAttachment): ConversationAttachment {
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
