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
  it('prefers extension process settings over local .env development defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_CHANNEL_ID=channel-1',
        'DISCORD_OWNER_IDS=owner-1',
        'ALLOWED_CHANNEL_IDS=channel-1',
        'USE_GEMINI_CLI_SESSIONS=false',
      ].join('\n'));

      vi.stubEnv('USE_GEMINI_CLI_SESSIONS', 'true');

      const config = loadConfig(tmpDir);

      expect(config.useGeminiCliSessions).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults Discord memory and Gemini sessions to channel isolation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_CHANNEL_ID=channel-1',
        'DISCORD_OWNER_IDS=owner-1',
        'DISCORD_ALLOWED_CHANNEL_IDS=channel-1',
      ].join('\n'));

      const config = loadConfig(tmpDir);

      expect(config.memoryScope).toBe('channel');
      expect(config.geminiSessionBindingScope).toBe('channel');
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

  it('prefers explicit server id over discovered Discord server metadata', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      const runtimePaths = resolveRuntimePaths(tmpDir);
      writeManagedConfigFile(runtimePaths.managedConfigFile, {
        version: 2,
        updatedAt: new Date().toISOString(),
        env: {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_SERVER_ID: 'configured-guild',
          DISCORD_OWNER_IDS: 'owner-1',
          SETUP_VALIDATION_PENDING: 'true',
        },
        discord: {
          primaryGuildId: 'discovered-guild',
          primaryGuildName: 'Operations',
        },
      });

      const config = loadConfig(tmpDir);

      expect(config.discordServerId).toBe('configured-guild');
      expect(config.setupValidationPending).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('marks manifest-configured installs for first-start validation without requiring setup script', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      fs.writeFileSync(path.join(tmpDir, '.env'), [
        'DISCORD_BOT_TOKEN=test-token',
        'DISCORD_OWNER_IDS=owner-1',
        'DISCORD_SERVER_ID=server-1',
      ].join('\n'));

      const config = loadConfig(tmpDir);

      expect(config.setupValidationPending).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors persisted setup validation completion after first-start DM is sent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-config-'));

    try {
      const runtimePaths = resolveRuntimePaths(tmpDir);
      writeManagedConfigFile(runtimePaths.managedConfigFile, {
        version: 2,
        updatedAt: new Date().toISOString(),
        env: {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_OWNER_IDS: 'owner-1',
          DISCORD_SERVER_ID: 'server-1',
          SETUP_VALIDATION_PENDING: 'false',
        },
        discord: {},
      });

      const config = loadConfig(tmpDir);

      expect(config.setupValidationPending).toBe(false);
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
