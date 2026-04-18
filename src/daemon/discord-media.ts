import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AttachmentBuilder, type Message, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import { log } from './log.js';
import { retrySend } from './retry.js';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(((?:https?|file):\/\/[^)]+|(?:\/|~\/)[^)]+)\)/g;
const STANDALONE_IMAGE_URL_RE = /^((?:https?|file):\/\/\S+|(?:\/|~\/)\S+)$/gm;
const MAX_OUTBOUND_IMAGES = 4;
const MAX_OUTBOUND_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#].*)?$/i;

type SendableChannel = TextChannel | DMChannel | NewsChannel;

interface ImageCandidate {
  alt: string;
  fullMatch: string;
  url: string;
}

export interface PreparedDiscordMessage {
  text: string;
  files: AttachmentBuilder[];
}

export async function prepareDiscordMessageContent(content: string): Promise<PreparedDiscordMessage> {
  const candidates = findImageCandidates(content).slice(0, MAX_OUTBOUND_IMAGES);
  let cleaned = content;
  const files: AttachmentBuilder[] = [];

  for (const candidate of candidates) {
    const file = await resolveImage(candidate);
    if (!file) {
      continue;
    }

    files.push(file);
    cleaned = cleaned.replace(candidate.fullMatch, '');
  }

  return {
    text: normalizeWhitespace(cleaned),
    files,
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

function findImageCandidates(content: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const seenMatches = new Set<string>();

  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
    const fullMatch = match[0];
    const alt = match[1] ?? '';
    const url = match[2] ?? '';
    if (!url || seenMatches.has(fullMatch)) continue;
    seenMatches.add(fullMatch);
    candidates.push({ alt, fullMatch, url });
  }

  for (const match of content.matchAll(STANDALONE_IMAGE_URL_RE)) {
    const fullMatch = match[0];
    const url = match[1] ?? '';
    if (!url || seenMatches.has(fullMatch) || !isProbablyImageUrl(url)) continue;
    seenMatches.add(fullMatch);
    candidates.push({ alt: '', fullMatch, url });
  }

  return candidates;
}

async function resolveImage(candidate: ImageCandidate): Promise<AttachmentBuilder | null> {
  if (candidate.url.startsWith('file://') || candidate.url.startsWith('/') || candidate.url.startsWith('~/')) {
    return resolveLocalImage(candidate);
  }
  return downloadRemoteImage(candidate);
}

async function downloadRemoteImage(candidate: ImageCandidate): Promise<AttachmentBuilder | null> {
  try {
    const response = await fetch(candidate.url);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/') && !isProbablyImageUrl(candidate.url)) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || buffer.length > MAX_OUTBOUND_IMAGE_BYTES) {
      return null;
    }

    const fileName = resolveFileName(candidate.url, contentType, candidate.alt);
    return new AttachmentBuilder(buffer, { name: fileName });
  } catch (err) {
    log.warn('Failed to download outbound image', {
      url: candidate.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function resolveLocalImage(candidate: ImageCandidate): Promise<AttachmentBuilder | null> {
  try {
    let filePath = decodeURIComponent(candidate.url.replace(/^file:\/\//, ''));
    if (filePath.startsWith('~/')) {
      filePath = path.join(os.homedir(), filePath.slice(2));
    }

    if (!isProbablyImageUrl(filePath)) {
      log.warn('Local file attachment rejected — not an image extension', { filePath });
      return null;
    }

    const buffer = await fs.readFile(filePath);
    if (buffer.length === 0 || buffer.length > MAX_OUTBOUND_IMAGE_BYTES) {
      log.warn('Local file attachment rejected — empty or oversized', {
        filePath,
        size: buffer.length,
      });
      return null;
    }

    const fileName = path.basename(filePath);
    return new AttachmentBuilder(buffer, { name: fileName });
  } catch (err) {
    log.warn('Failed to read local image file', {
      url: candidate.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function resolveFileName(url: string, contentType: string, alt: string): string {
  try {
    const parsed = new URL(url);
    const rawBaseName = path.basename(parsed.pathname) || sanitizeAttachmentName(alt) || 'image';
    const extFromPath = path.extname(rawBaseName);
    const extFromMimeType = extensionFromMimeType(contentType);

    if (extFromPath) {
      return sanitizeAttachmentName(rawBaseName);
    }

    return `${sanitizeAttachmentName(rawBaseName)}${extFromMimeType}`;
  } catch {
    return sanitizeAttachmentName(alt) || 'image.png';
  }
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
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
