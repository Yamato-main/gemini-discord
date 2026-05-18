import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import { downloadSupportedAttachments, getSupportedAttachmentMetadata } from '../src/daemon/attachments.js';

let tmpDir: string;
let originalFetch: typeof fetch;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-attachments-'));
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getSupportedAttachmentMetadata', () => {
  it('includes images, videos, PDFs, and text-like attachments', () => {
    const message = createMessage('m0', [
      { id: 'a1', name: 'reference.png', contentType: 'image/png', size: 16, url: 'url1' },
      { id: 'a2', name: 'clip.webm', contentType: 'video/webm', size: 1024, url: 'url2' },
      { id: 'a3', name: 'notes.md', contentType: 'text/markdown', size: 256, url: 'url3' },
      { id: 'a4', name: 'report.pdf', contentType: 'application/pdf', size: 2048, url: 'url4' },
      { id: 'a5', name: 'archive.zip', contentType: 'application/zip', size: 2048, url: 'url5' },
    ]);

    expect(getSupportedAttachmentMetadata(message).map((attachment) => attachment.name)).toEqual([
      'reference.png',
      'clip.webm',
      'notes.md',
      'report.pdf',
    ]);
  });

  it('accepts supported files by extension when Discord omits the content type', () => {
    const message = createMessage('m1', [
      { id: 'a1', name: 'clip.mp4', contentType: null, size: 1024, url: 'url1' },
      { id: 'a2', name: 'notes.md', contentType: null, size: 256, url: 'url2' },
      { id: 'a3', name: 'unknown.bin', contentType: null, size: 256, url: 'url3' },
    ]);

    expect(getSupportedAttachmentMetadata(message).map((attachment) => attachment.name)).toEqual([
      'clip.mp4',
      'notes.md',
    ]);
  });
});

describe('downloadSupportedAttachments', () => {
  it('downloads Discord attachments into the binding workspace', async () => {
    globalThis.fetch = vi.fn(async () => new Response(Buffer.from('fake-file-bytes'), { status: 200 })) as typeof fetch;
    const bindingDir = path.join(tmpDir, 'binding');
    const attachmentsRoot = path.join(bindingDir, 'discord-attachments');

    const message = createMessage('m2', [
      {
        id: 'a1',
        name: 'clip.mp4',
        contentType: 'video/mp4',
        size: 16,
        url: 'https://cdn.discordapp.test/clip.mp4',
      },
    ]);

    const downloaded = await downloadSupportedAttachments(message, attachmentsRoot, bindingDir);

    expect(downloaded).toHaveLength(1);
    const expectedRelativePath = path.relative(bindingDir, downloaded[0].localPath);
    expect(downloaded[0].relativePath).toBe(expectedRelativePath);
    expect(downloaded[0].kind).toBe('video');
    expect(downloaded[0].inlineData).toEqual({
      data: Buffer.from('fake-file-bytes').toString('base64'),
      mimeType: 'video/mp4',
    });
    expect(fs.existsSync(downloaded[0].localPath)).toBe(true);
    expect(fs.readFileSync(downloaded[0].localPath, 'utf-8')).toBe('fake-file-bytes');
  });

  it('infers inline media MIME types when Discord omits content type', async () => {
    globalThis.fetch = vi.fn(async () => new Response(Buffer.from('fake-image-bytes'), { status: 200 })) as typeof fetch;
    const bindingDir = path.join(tmpDir, 'binding');
    const attachmentsRoot = path.join(bindingDir, 'discord-attachments');
    const message = createMessage('m2b', [
      {
        id: 'a1',
        name: 'panel.jpg',
        contentType: null,
        size: 16,
        url: 'https://cdn.discordapp.test/panel.jpg',
      },
    ]);

    const downloaded = await downloadSupportedAttachments(message, attachmentsRoot, bindingDir);

    expect(downloaded[0].kind).toBe('image');
    expect(downloaded[0].inlineData?.mimeType).toBe('image/jpeg');
  });

  it('downloads multiple attachments in parallel', async () => {
    const delay = 50;
    globalThis.fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response(Buffer.from('fake-image-bytes'), { status: 200 });
    }) as typeof fetch;

    const bindingDir = path.join(tmpDir, 'binding');
    const attachmentsRoot = path.join(bindingDir, 'discord-attachments');
    const message = createMessage('m3', [
      { id: 'a1', name: 'img1.png', contentType: 'image/png', size: 100, url: 'url1' },
      { id: 'a2', name: 'clip.mp4', contentType: 'video/mp4', size: 100, url: 'url2' },
      { id: 'a3', name: 'notes.md', contentType: 'text/markdown', size: 100, url: 'url3' },
      { id: 'a4', name: 'report.pdf', contentType: 'application/pdf', size: 100, url: 'url4' },
    ]);

    const start = Date.now();
    const downloaded = await downloadSupportedAttachments(message, attachmentsRoot, bindingDir);
    const end = Date.now();

    expect(downloaded).toHaveLength(4);
    // If serial, it would take at least 4 * 50 = 200ms.
    // If parallel, it should take ~50ms (plus overhead). 
    // We use a safe threshold like 150ms.
    expect(end - start).toBeLessThan(150);
  });
});

function createMessage(
  messageId: string,
  attachments: Array<{
    id: string;
    name: string;
    contentType: string | null;
    size: number;
    url: string;
  }>,
): Message {
  return {
    id: messageId,
    attachments: new Map(
      attachments.map((attachment) => [
        attachment.id,
        {
          ...attachment,
        },
      ]),
    ),
  } as unknown as Message;
}
