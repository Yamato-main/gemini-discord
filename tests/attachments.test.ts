import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import { downloadImageAttachments } from '../src/daemon/attachments.js';

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

describe('downloadImageAttachments', () => {
  it('downloads Discord image attachments into the binding workspace', async () => {
    globalThis.fetch = vi.fn(async () => new Response(Buffer.from('fake-image-bytes'), { status: 200 })) as typeof fetch;
    const attachmentsRoot = path.join(tmpDir, 'discord-attachments');

    const message = createMessage('m1', [
      {
        id: 'a1',
        name: 'reference.png',
        contentType: 'image/png',
        size: 16,
        url: 'https://cdn.discordapp.test/reference.png',
      },
    ]);

    const downloaded = await downloadImageAttachments(message, attachmentsRoot);

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].relativePath).toBe(path.join('discord-attachments', 'm1', '1-reference.png'));
    expect(fs.existsSync(downloaded[0].localPath)).toBe(true);
    expect(fs.readFileSync(downloaded[0].localPath, 'utf-8')).toBe('fake-image-bytes');
  });

  it('downloads multiple attachments in parallel', async () => {
    const delay = 50;
    globalThis.fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response(Buffer.from('fake-image-bytes'), { status: 200 });
    }) as typeof fetch;

    const attachmentsRoot = path.join(tmpDir, 'discord-attachments');
    const message = createMessage('m2', [
      { id: 'a1', name: 'img1.png', contentType: 'image/png', size: 100, url: 'url1' },
      { id: 'a2', name: 'img2.png', contentType: 'image/png', size: 100, url: 'url2' },
      { id: 'a3', name: 'img3.png', contentType: 'image/png', size: 100, url: 'url3' },
      { id: 'a4', name: 'img4.png', contentType: 'image/png', size: 100, url: 'url4' },
    ]);

    const start = Date.now();
    const downloaded = await downloadImageAttachments(message, attachmentsRoot);
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
    contentType: string;
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
