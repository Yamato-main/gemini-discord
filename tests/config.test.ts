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
        'AUTONOMOUS_TURNS_ENABLED=true',
        'AUTONOMOUS_4CHAN_A_ENABLED=true',
        'AUTONOMOUS_4CHAN_A_KEYWORDS=one piece,spoilers',
      ].join('\n'));

      vi.stubEnv('USE_GEMINI_CLI_SESSIONS', 'false');
      vi.stubEnv('AUTONOMOUS_TURNS_ENABLED', 'false');

      const config = loadConfig(tmpDir);

      expect(config.useGeminiCliSessions).toBe(true);
      expect(config.autonomous.enabled).toBe(true);
      expect(config.autonomous.fourChan.enabled).toBe(true);
      expect(config.autonomous.fourChan.keywords).toEqual(['one piece', 'spoilers']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
