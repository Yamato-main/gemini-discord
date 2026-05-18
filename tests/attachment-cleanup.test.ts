import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupStaleTmpAttachments } from '../src/daemon/attachment-cleanup.js';

describe('cleanupStaleTmpAttachments', () => {
  it('removes stale entries from .tmp-attachments and keeps recent entries', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cleanup-'));
    try {
      const root = path.join(tmpDir, '.tmp-attachments');
      const staleDir = path.join(root, 'gemini-discord-att-old');
      const recentDir = path.join(root, 'gemini-discord-att-new');
      const staleFile = path.join(root, 'old.png');
      const nowMs = new Date('2026-05-12T10:00:00.000Z').getTime();
      const staleDate = new Date(nowMs - 25 * 60 * 60 * 1000);
      const recentDate = new Date(nowMs - 10 * 60 * 1000);

      fs.mkdirSync(staleDir, { recursive: true });
      fs.mkdirSync(recentDir, { recursive: true });
      fs.writeFileSync(path.join(staleDir, 'clip.mp4'), 'old');
      fs.writeFileSync(path.join(recentDir, 'notes.md'), 'new');
      fs.writeFileSync(staleFile, 'old-file');
      fs.utimesSync(staleDir, staleDate, staleDate);
      fs.utimesSync(recentDir, recentDate, recentDate);
      fs.utimesSync(staleFile, staleDate, staleDate);

      const result = await cleanupStaleTmpAttachments(tmpDir, {
        nowMs,
        ttlMs: 24 * 60 * 60 * 1000,
      });

      expect(result).toMatchObject({ checked: 3, removed: 2 });
      expect(fs.existsSync(staleDir)).toBe(false);
      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(recentDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does nothing when .tmp-attachments does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-cleanup-'));
    try {
      await expect(cleanupStaleTmpAttachments(tmpDir)).resolves.toMatchObject({
        checked: 0,
        removed: 0,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
