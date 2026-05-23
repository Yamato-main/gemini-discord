import { describe, expect, it } from 'vitest';
import { sanitizeAllowedUserIds } from '../src/shared/config-sanitize.js';
import { createConfig } from './test-utils/factories.js';

describe('sanitizeAllowedUserIds', () => {
  it('removes the bot and boss from the human guest allowlist', () => {
    const config = createConfig({
      discordBossUserId: '111111111111111111',
      allowedUserIds: ['111111111111111111', '999999999999999999', '222222222222222222'],
    });

    const result = sanitizeAllowedUserIds(config, '999999999999999999');

    expect(result.allowedUserIds).toEqual(['222222222222222222']);
    expect(result.changed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('bot user'))).toBe(true);
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

  it('warns when the boss id matches the bot account', () => {
    const config = createConfig({
      discordBossUserId: '999999999999999999',
      allowedUserIds: [],
    });

    const result = sanitizeAllowedUserIds(config, '999999999999999999');

    expect(result.warnings.some((warning) => warning.includes('DISCORD_BOSS_USER_ID matches the bot'))).toBe(true);
  });
});
