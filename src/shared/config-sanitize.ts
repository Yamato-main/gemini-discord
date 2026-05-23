import type { Config } from './types.js';
import { validateBossConfig } from '../daemon/permissions.js';

export interface ConfigSanitizeResult {
  allowedUserIds: string[];
  changed: boolean;
  warnings: string[];
}

/**
 * Remove IDs that must never be on the human guest allowlist.
 */
export function sanitizeAllowedUserIds(
  config: Config,
  botUserId: string | null | undefined,
): ConfigSanitizeResult {
  const warnings: string[] = [];
  const drop = new Set<string>();

  if (botUserId?.trim()) {
    drop.add(botUserId.trim());
  }

  const boss = validateBossConfig(config);
  if (boss.valid) {
    drop.add(boss.bossUserId);
  }
  for (const id of config.allowedAgentIds) {
    drop.add(id);
  }

  const before = config.allowedUserIds;
  const allowedUserIds = before.filter((id) => {
    if (!drop.has(id)) {
      return true;
    }
    if (botUserId && id === botUserId) {
      warnings.push(
        `Removed bot user ${id} from DISCORD_ALLOWED_USER_IDS. The guest allowlist is for humans only; the bot must never be allowlisted.`,
      );
    } else if (boss.valid && id === boss.bossUserId) {
      warnings.push(
        `Removed boss user ${id} from DISCORD_ALLOWED_USER_IDS. Boss authority comes from DISCORD_BOSS_USER_ID, not the guest allowlist.`,
      );
    } else if (config.allowedAgentIds.includes(id)) {
      warnings.push(
        `Removed agent/bot user ${id} from DISCORD_ALLOWED_USER_IDS. Agent identities belong in DISCORD_ALLOWED_AGENT_IDS, not the human guest allowlist.`,
      );
    }
    return false;
  });

  if (boss.valid && botUserId && boss.bossUserId === botUserId) {
    warnings.push(
      'DISCORD_BOSS_USER_ID matches the bot account. Set it to the human operator\'s numeric Discord user ID or privileged actions will fail.',
    );
  }

  return {
    allowedUserIds,
    changed: allowedUserIds.length !== before.length,
    warnings,
  };
}
