import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../src/shared/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  it('prefers explicit .env values over inherited process env for daemon settings', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_CHANNEL_ID=channel-1',
        'DISCORD_OWNER_IDS=owner-1',
        'ALLOWED_CHANNEL_IDS=channel-1',
        'USE_GEMINI_CLI_SESSIONS=true',
      ].join('\n'));

      vi.stubEnv('USE_GEMINI_CLI_SESSIONS', 'false');

      const config = loadConfig(tmpDir);

      expect(config.useGeminiCliSessions).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults memory and Gemini sessions to the global agent context', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_CHANNEL_ID=channel-1',
        'DISCORD_OWNER_IDS=owner-1',
        'DISCORD_ALLOWED_CHANNEL_IDS=channel-1',
      ].join('\n'));

      const config = loadConfig(tmpDir);

      expect(config.memoryScope).toBe('global');
      expect(config.geminiSessionBindingScope).toBe('global');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
