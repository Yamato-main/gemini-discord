import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from 'discord.js';
import { downloadImageAttachments, pruneAttachmentCache } from '../src/daemon/attachments.js';

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

    const message = createMessage('m1', [
      {
        id: 'a1',
        name: 'reference.png',
        contentType: 'image/png',
        size: 16,
        url: 'https://cdn.discordapp.test/reference.png',
      },
    ]);

    const downloaded = await downloadImageAttachments(message, tmpDir);

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].relativePath).toBe(path.join('m1', '1-reference.png'));
    expect(fs.existsSync(downloaded[0].localPath)).toBe(true);
    expect(fs.readFileSync(downloaded[0].localPath, 'utf-8')).toBe('fake-image-bytes');
  });
});

describe('pruneAttachmentCache', () => {
  it('removes the oldest attachment directories while preserving the current turn', async () => {
    const oldestDir = createAttachmentDir('oldest', '1111');
    const middleDir = createAttachmentDir('middle', '2222');
    const newestDir = createAttachmentDir('newest', '3333');

    setMtime(oldestDir, 1_000);
    setMtime(middleDir, 2_000);
    setMtime(newestDir, 3_000);

    await pruneAttachmentCache(tmpDir, [newestDir], { maxMessageDirs: 2, maxBytes: 8 });

    expect(fs.existsSync(oldestDir)).toBe(false);
    expect(fs.existsSync(middleDir)).toBe(true);
    expect(fs.existsSync(newestDir)).toBe(true);
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

function createAttachmentDir(name: string, contents: string): string {
  const dirPath = path.join(tmpDir, name);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, 'image.png'), contents, 'utf-8');
  return dirPath;
}

function setMtime(dirPath: string, timestampMs: number): void {
  const time = new Date(timestampMs);
  fs.utimesSync(dirPath, time, time);
  fs.utimesSync(path.join(dirPath, 'image.png'), time, time);
}
