import * as path from 'node:path';
import * as fs from 'node:fs';
import { AttachmentBuilder, type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { log } from './log.js';
import { retrySend } from './retry.js';
import type { ConversationAttachment } from '../shared/types.js';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(((?:https?:\/\/|file:\/\/|\/)[^)]+)\)/g;
const STANDALONE_IMAGE_URL_RE = /^((?:https?:\/\/|file:\/\/|\/).+)$/gm;
const MAX_OUTBOUND_IMAGES = 4;
const MAX_OUTBOUND_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#].*)?$/i;

type SendableChannel = TextChannel | DMChannel | NewsChannel;

interface RemoteImageCandidate {
  alt: string;
  fullMatch: string;
  url: string;
}

export interface PreparedDiscordMessage {
  text: string;
  files: AttachmentBuilder[];
  attachments: ConversationAttachment[];
}

export async function prepareDiscordMessageContent(content: string): Promise<PreparedDiscordMessage> {
  const candidates = findRemoteImageCandidates(content).slice(0, MAX_OUTBOUND_IMAGES);
  let cleaned = content;
  const files: AttachmentBuilder[] = [];
  const attachments: ConversationAttachment[] = [];

  for (const candidate of candidates) {
    const result = await downloadRemoteImage(candidate);
    if (!result) {
      continue;
    }

    files.push(result.file);
    attachments.push(result.metadata);

    // Escape special characters in the URL for use in regex
    const escapedUrl = candidate.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Pattern to match both Markdown images: ![alt](url) and Standalone URLs: url
    // We remove all occurrences of this URL from the text to prevent redundant Discord embeds.
    const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g');
    const standalonePattern = new RegExp(`(^|\\s)${escapedUrl}(\\s|$)`, 'g');
    
    cleaned = cleaned.replace(markdownPattern, '');
    cleaned = cleaned.replace(standalonePattern, '$1$2');
  }

  return {
    text: normalizeWhitespace(cleaned),
    files,
    attachments,
  };
}

export async function sendPreparedDiscordFiles(
  channel: SendableChannel,
  files: AttachmentBuilder[],
): Promise<string[]> {
  const messageIds: string[] = [];

  for (let index = 0; index < files.length; index += 10) {
    const batch = files.slice(index, index + 10);
    const sent = await retrySend(() => channel.send({ files: batch }));
    messageIds.push(sent.id);
  }

  return messageIds;
}

export async function sendDiscordContent(
  channel: SendableChannel,
  content: string,
  chunkFn: (text: string) => string[],
  options: { replyTo?: Message } = {},
): Promise<string[]> {
  const prepared = await prepareDiscordMessageContent(content);
  const messageIds: string[] = [];
  let replied = false;

  if (prepared.text) {
    const chunks = chunkFn(prepared.text);
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

  if (prepared.files.length > 0) {
    for (let index = 0; index < prepared.files.length; index += 10) {
      const batch = prepared.files.slice(index, index + 10);
      const sent = !replied && options.replyTo && index === 0
        ? await retrySend(() => options.replyTo!.reply({ files: batch }))
        : await retrySend(() => channel.send({ files: batch }));
      messageIds.push(sent.id);
      replied = true;
    }
  }

  return messageIds;
}

export function findRemoteImageCandidates(content: string): RemoteImageCandidate[] {
  const candidates: RemoteImageCandidate[] = [];
  const seenUrls = new Set<string>();

  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
    const fullMatch = match[0];
    const alt = match[1] ?? '';
    const url = match[2] ?? '';
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    candidates.push({ alt, fullMatch, url });
  }

  for (const match of content.matchAll(STANDALONE_IMAGE_URL_RE)) {
    const fullMatch = match[0];
    const url = match[1] ?? '';
    if (!url || seenUrls.has(url) || !isProbablyImageUrl(url)) continue;
    seenUrls.add(url);
    candidates.push({ alt: '', fullMatch, url });
  }

  return candidates;
}

async function downloadRemoteImage(candidate: RemoteImageCandidate): Promise<{ file: AttachmentBuilder; metadata: ConversationAttachment } | null> {
  try {
    const isLocal = candidate.url.startsWith('/') || candidate.url.startsWith('file://');
    let buffer: Buffer;
    let fileName: string;
    let contentType = 'image/png';

    if (isLocal) {
      const rawPath = candidate.url.startsWith('file://') ? decodeURIComponent(candidate.url.slice(7)) : decodeURIComponent(candidate.url);
      
      // Handle both Unix-style escaped spaces (\ ) and potential literal backslashes
      // that the LLM might include in its path guess.
      const filePath = rawPath.replace(/\\ /g, ' ').replace(/\\(?=[^ ])/g, '');

      buffer = await fs.promises.readFile(filePath);
      if (buffer.length === 0 || buffer.length > MAX_OUTBOUND_IMAGE_BYTES) {
        return null;
      }
      
      const parsedExt = path.extname(filePath);
      const rawBaseName = path.basename(filePath) || sanitizeAttachmentName(candidate.alt) || 'image';
      fileName = parsedExt ? sanitizeAttachmentName(rawBaseName) : `${sanitizeAttachmentName(rawBaseName)}.png`;
      contentType = extensionToMimeType(parsedExt);
    } else {
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        return null;
      }

      const ct = response.headers.get('content-type') ?? '';
      if (!ct.startsWith('image/') && !isProbablyImageUrl(candidate.url)) {
        return null;
      }
      contentType = ct;

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      if (buffer.length === 0 || buffer.length > MAX_OUTBOUND_IMAGE_BYTES) {
        return null;
      }

      fileName = resolveFileName(candidate.url, contentType, candidate.alt);
    }

    return {
      file: new AttachmentBuilder(buffer, { name: fileName }),
      metadata: {
        name: fileName,
        contentType,
        sizeBytes: buffer.length,
        url: isLocal ? undefined : candidate.url,
      },
    };
  } catch (err) {
    log.warn('Failed to generate outbound image attachment', {
      url: candidate.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function extensionToMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}

function resolveFileName(url: string, contentType: string, alt: string): string {
  const parsed = new URL(url);
  const rawBaseName = path.basename(parsed.pathname) || sanitizeAttachmentName(alt) || 'image';
  const extFromPath = path.extname(rawBaseName);
  const extFromMimeType = extensionFromMimeType(contentType);

  if (extFromPath) {
    return sanitizeAttachmentName(rawBaseName);
  }

  return `${sanitizeAttachmentName(rawBaseName)}${extFromMimeType}`;
}

function extensionFromMimeType(contentType: string): string {
  switch (contentType.split(';', 1)[0]) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/bmp':
      return '.bmp';
    default:
      return '.png';
  }
}

function sanitizeAttachmentName(value: string): string {
  const trimmed = value.trim() || 'image';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isProbablyImageUrl(url: string): boolean {
  return IMAGE_EXT_RE.test(url) || url.includes('i.imgur.com/');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
