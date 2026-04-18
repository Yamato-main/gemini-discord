import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { prepareDiscordMessageContent } from '../src/daemon/discord-media.js';

describe('prepareDiscordMessageContent', () => {
  it('identifies and prepares remote http images', async () => {
    // Mock fetch for remote images
    const mockBuffer = Buffer.from('fake-image-data');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'image/png']]),
      arrayBuffer: () => Promise.resolve(mockBuffer.buffer),
    }));

    const content = 'Check this out: ![cool](https://example.com/image.png)';
    const prepared = await prepareDiscordMessageContent(content);

    expect(prepared.text).toBe('Check this out:');
    expect(prepared.files).toHaveLength(1);
    expect(prepared.files[0].name).toBe('image.png');
    
    vi.unstubAllGlobals();
  });

  it('identifies and prepares local file images', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-discord-media-test-'));
    const testImagePath = path.join(tmpDir, 'test-image.png');
    await fs.writeFile(testImagePath, Buffer.from('fake-local-image'));

    const fileUri = `file://${testImagePath}`;
    const content = `Local file: ![local](${fileUri})`;
    
    const prepared = await prepareDiscordMessageContent(content);

    try {
      expect(prepared.text).toBe('Local file:');
      expect(prepared.files).toHaveLength(1);
      expect(prepared.files[0].name).toBe('test-image.png');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('identifies and prepares absolute local file paths', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-discord-media-test-'));
    const testImagePath = path.join(tmpDir, 'test-image-abs.png');
    await fs.writeFile(testImagePath, Buffer.from('fake-local-image-abs'));

    const content = `Local file: ![abs](${testImagePath})`;
    
    const prepared = await prepareDiscordMessageContent(content);

    try {
      expect(prepared.text).toBe('Local file:');
      expect(prepared.files).toHaveLength(1);
      expect(prepared.files[0].name).toBe('test-image-abs.png');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('identifies and prepares paths with spaces', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-discord-media-test-'));
    const testImagePath = path.join(tmpDir, 'test image abs.png');
    await fs.writeFile(testImagePath, Buffer.from('fake-local-image-abs-spaces'));

    const content = `Local file with space: ![abs spaces](${testImagePath})`;
    
    const prepared = await prepareDiscordMessageContent(content);

    try {
      expect(prepared.text).toBe('Local file with space:');
      expect(prepared.files).toHaveLength(1);
      expect(prepared.files[0].name).toBe('test image abs.png');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('ignores non-image file extensions for local files (security)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-discord-media-test-'));
    const secretPath = path.join(tmpDir, '.env');
    await fs.writeFile(secretPath, 'SECRET_KEY=12345');

    const fileUri = `file://${secretPath}`;
    const content = `Secret file: ![env](${fileUri})`;
    
    const prepared = await prepareDiscordMessageContent(content);

    try {
      // Should NOT have extracted the file
      expect(prepared.files).toHaveLength(0);
      expect(prepared.text).toContain(`![env](${fileUri})`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
