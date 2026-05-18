import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDiscordMessage } from '../src/daemon/sender.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-sender-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sendDiscordMessage', () => {
  it('sends the first caption with the first attachment batch', async () => {
    const imagePath = path.join(tmpDir, 'image.png');
    fs.writeFileSync(imagePath, 'fake-image');
    const channel = {
      send: vi.fn(async () => ({ id: `m${channel.send.mock.calls.length}` })),
    };

    const messageIds = await sendDiscordMessage(
      channel as any,
      'here is the image',
      (text) => [text],
      { files: [imagePath] },
    );

    expect(messageIds).toEqual(['m1']);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      content: 'here is the image',
      files: expect.any(Array),
    }));
  });

  it('does not send text when the requested attachment is unreadable', async () => {
    const channel = {
      send: vi.fn(async () => ({ id: 'm1' })),
    };

    await expect(sendDiscordMessage(
      channel as any,
      'here is the image',
      (text) => [text],
      { files: [path.join(tmpDir, 'missing.png')] },
    )).rejects.toThrow('Attachment file is not readable');

    expect(channel.send).not.toHaveBeenCalled();
  });
});
