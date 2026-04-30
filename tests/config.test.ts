import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../src/shared/config.js';
import { readManagedConfigFile, writeManagedConfigFile } from '../src/shared/managed-config.js';
import { resolveRuntimePaths } from '../src/shared/runtime-paths.js';

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

  it('creates a managed runtime config file with the resolved install settings', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_CHANNEL_ID=channel-1',
        'DISCORD_OWNER_IDS=owner-1',
      ].join('\n'));

      loadConfig(tmpDir);

      const managedConfig = readManagedConfigFile(resolveRuntimePaths(tmpDir).managedConfigFile);
      expect(managedConfig.env.DISCORD_BOT_TOKEN).toBe('test-token');
      expect(managedConfig.env.DISCORD_CHANNEL_ID).toBe('channel-1');
      expect(managedConfig.env.DISCORD_OWNER_IDS).toBe('owner-1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads discovered Discord server metadata from the managed config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      const runtimePaths = resolveRuntimePaths(tmpDir);
      writeManagedConfigFile(runtimePaths.managedConfigFile, {
        version: 2,
        updatedAt: new Date().toISOString(),
        env: {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_CHANNEL_ID: 'channel-1',
          DISCORD_OWNER_IDS: 'owner-1',
        },
        discord: {
          primaryGuildId: 'guild-1',
          primaryGuildName: 'Operations',
        },
      });

      const config = loadConfig(tmpDir);

      expect(config.discordServerId).toBe('guild-1');
      expect(config.discordServerName).toBe('Operations');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats blank .env overrides as unmanaged so discovered settings keep working', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      const runtimePaths = resolveRuntimePaths(tmpDir);
      writeManagedConfigFile(runtimePaths.managedConfigFile, {
        version: 2,
        updatedAt: new Date().toISOString(),
        env: {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_CHANNEL_ID: 'remembered-channel',
          DISCORD_OWNER_IDS: 'owner-1',
        },
        discord: {},
      });

      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_CHANNEL_ID=',
        'DISCORD_OWNER_IDS=',
      ].join('\n'));

      const config = loadConfig(tmpDir);

      expect(config.discordChannelId).toBe('remembered-channel');
      expect(config.ownerIds).toEqual(['owner-1']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
