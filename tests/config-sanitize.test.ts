import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sanitizeAllowedUserIds } from '../src/shared/config-sanitize.js';
import { persistConfigEnvUpdates } from '../src/shared/config.js';
import { readManagedConfigFile } from '../src/shared/managed-config.js';
import { resolveRuntimePaths } from '../src/shared/runtime-paths.js';
import { ENV } from '../src/shared/config-vars.js';
import { createConfig } from './test-utils/factories.js';

describe('sanitizeAllowedUserIds', () => {
  it('removes the bridge admin and boss from the human guest allowlist', () => {
    const config = createConfig({
      discordBossUserId: '111111111111111111',
      allowedUserIds: ['111111111111111111', '999999999999999999', '222222222222222222'],
    });

    const result = sanitizeAllowedUserIds(config, '999999999999999999');

    expect(result.allowedUserIds).toEqual(['222222222222222222']);
    expect(result.changed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('bridge admin'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('boss user'))).toBe(true);
  });

  it('removes allowed agent ids from the human guest allowlist', () => {
    const config = createConfig({
      allowedAgentIds: ['333333333333333333'],
      allowedUserIds: ['222222222222222222', '333333333333333333'],
    });

    const result = sanitizeAllowedUserIds(config, null);

    expect(result.allowedUserIds).toEqual(['222222222222222222']);
    expect(result.changed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('agent/bot user'))).toBe(true);
  });

  it('warns when the boss id matches the bridge admin account', () => {
    const config = createConfig({
      discordBossUserId: '999999999999999999',
      allowedUserIds: [],
    });

    const result = sanitizeAllowedUserIds(config, '999999999999999999');

    expect(result.warnings.some((warning) => warning.includes('DISCORD_BOSS_USER_ID matches the bridge admin'))).toBe(true);
  });

  it('reports changed=false and produces no warnings for a clean allowlist', () => {
    const config = createConfig({
      discordBossUserId: '111111111111111111',
      allowedUserIds: ['222222222222222222'],
    });

    const result = sanitizeAllowedUserIds(config, '999999999999999999');

    expect(result.allowedUserIds).toEqual(['222222222222222222']);
    expect(result.changed).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe('startup sanitization persistence', () => {
  it('persists sanitized allowlist through persistConfigEnvUpdates when changes are made', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-sanitize-persist-'));

    try {
      const config = createConfig({
        discordBossUserId: '111111111111111111',
        allowedUserIds: ['111111111111111111', '999999999999999999', '222222222222222222'],
      });

      const result = sanitizeAllowedUserIds(config, '999999999999999999');

      expect(result.changed).toBe(true);

      // Simulate the daemon startup persistence path
      persistConfigEnvUpdates(tmpDir, {
        [ENV.DISCORD_ALLOWED_USER_IDS]: result.allowedUserIds.join(','),
      });

      const persisted = readManagedConfigFile(resolveRuntimePaths(tmpDir).managedConfigFile);
      expect(persisted.env.DISCORD_ALLOWED_USER_IDS).toBe('222222222222222222');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not persist when sanitizer makes no changes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-sanitize-noop-'));

    try {
      const config = createConfig({
        discordBossUserId: '111111111111111111',
        allowedUserIds: ['222222222222222222'],
      });

      const result = sanitizeAllowedUserIds(config, '999999999999999999');

      expect(result.changed).toBe(false);

      // The daemon startup path only calls persist when changed === true.
      // Verify the managed config file does not exist (nothing was persisted).
      const managedPath = resolveRuntimePaths(tmpDir).managedConfigFile;
      expect(fs.existsSync(managedPath)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
