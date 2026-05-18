import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSetupEnv,
  promptForSetupInput,
  validateSetupInput,
  writeSetupConfig,
} from '../scripts/setup.js';
import { readManagedConfigFile } from '../src/shared/managed-config.js';
import { resolveRuntimePaths } from '../src/shared/runtime-paths.js';
import { ENV } from '../src/shared/config-vars.js';

describe('setup script helpers', () => {
  it('prompts for exactly the three required setup inputs', async () => {
    const prompts: string[] = [];
    const answers = ['token', '123456789012345', '234567890123456'];

    const result = await promptForSetupInput({
      question: async (prompt: string) => {
        prompts.push(prompt);
        return answers[prompts.length - 1];
      },
    } as any);

    expect(prompts).toEqual(['Bot Token: ', 'Boss User ID: ', 'Server ID: ']);
    expect(result).toEqual({
      botToken: 'token',
      userId: '123456789012345',
      serverId: '234567890123456',
    });
  });

  it('builds managed setup env without channel or env-file writes', () => {
    const env = buildSetupEnv({
      botToken: 'token',
      userId: '123456789012345',
      serverId: '234567890123456',
    });

    expect(env).toMatchObject({
      [ENV.DISCORD_BOT_TOKEN]: 'token',
      [ENV.DISCORD_BOSS_USER_ID]: '123456789012345',
      [ENV.DISCORD_OWNER_IDS]: '123456789012345',
      [ENV.DISCORD_ADMIN_ID]: '123456789012345',
      [ENV.DISCORD_ALLOWED_USER_IDS]: '123456789012345',
      [ENV.DISCORD_SERVER_ID]: '234567890123456',
      [ENV.SETUP_VALIDATION_PENDING]: 'true',
    });
    expect(env).not.toHaveProperty(ENV.DISCORD_CHANNEL_ID);
  });

  it('rejects missing token or malformed Discord ids without reprompting', () => {
    expect(() => validateSetupInput({
      botToken: '',
      userId: '123456789012345',
      serverId: '234567890123456',
    })).toThrow(/Bot Token/);

    expect(() => validateSetupInput({
      botToken: 'token',
      userId: 'not-a-user-id',
      serverId: '234567890123456',
    })).toThrow(/User ID/);
  });

  it('writes ignored managed config and clears stale channel pinning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-setup-'));

    try {
      writeSetupConfig(tmpDir, {
        botToken: 'token',
        userId: '123456789012345',
        serverId: '234567890123456',
      });

      const config = readManagedConfigFile(resolveRuntimePaths(tmpDir).managedConfigFile);
      expect(config.env[ENV.DISCORD_BOT_TOKEN]).toBe('token');
      expect(config.env[ENV.DISCORD_BOSS_USER_ID]).toBe('123456789012345');
      expect(config.env[ENV.DISCORD_SERVER_ID]).toBe('234567890123456');
      expect(config.env[ENV.DISCORD_CHANNEL_ID]).toBeUndefined();
      expect(config.discord.primaryGuildId).toBe('234567890123456');
      expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
