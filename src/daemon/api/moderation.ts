import * as http from 'node:http';
import { ActivityType } from 'discord.js';
import {
  respond,
  authorizeApiAction,
  parseOptionalNumber,
  type ApiDependencies,
} from '../api-utils.js';

const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;

export async function handleModerationRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  parsed: Record<string, unknown>,
  deps: ApiDependencies,
): Promise<boolean> {
  const { config } = deps;

  if (pathname === '/moderation') {
    if (!authorizeApiAction(req, res, config, 'moderation')) return true;
    const action = String(parsed['action'] ?? '');
    const userId = String(parsed['user_id'] ?? '').trim();
    const guildId = String(parsed['guild_id'] ?? config.discordServerId ?? '').trim();
    const reason = parsed['reason'] == null ? undefined : String(parsed['reason']);
    const durationMinutes = parseOptionalNumber(parsed['duration_minutes']);

    if (!['kick', 'timeout', 'remove_timeout'].includes(action)) {
      respond(res, 400, { error: 'action must be kick, timeout, or remove_timeout' });
      return true;
    }
    if (!userId) {
      respond(res, 400, { error: 'user_id is required' });
      return true;
    }
    if (!DISCORD_SNOWFLAKE_RE.test(userId)) {
      respond(res, 400, { error: 'user_id must be a stable numeric Discord user ID. Use user discovery to resolve names or mentions first.' });
      return true;
    }
    if (!guildId) {
      respond(res, 400, { error: 'guild_id is required because no Discord server is configured' });
      return true;
    }
    if (userId === deps.client?.user?.id) {
      respond(res, 400, { error: 'Refusing to moderate the bot user' });
      return true;
    }
    if (config.discordBossUserId && userId === config.discordBossUserId) {
      respond(res, 400, { error: 'Refusing to moderate the configured authorized Discord user' });
      return true;
    }
    if (action === 'timeout') {
      if (durationMinutes === null || durationMinutes <= 0) {
        respond(res, 400, { error: 'duration_minutes must be greater than 0 for timeout' });
        return true;
      }
      if (durationMinutes > 40320) {
        respond(res, 400, { error: 'duration_minutes cannot exceed 40320 minutes (28 days)' });
        return true;
      }
    }

    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const guild = await deps.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      if (action === 'kick') {
        await member.kick(reason);
      } else if (action === 'timeout') {
        await member.timeout((durationMinutes ?? 0) * 60_000, reason);
      } else {
        await member.timeout(null, reason);
      }

      respond(res, 200, { ok: true, action, user_id: userId, guild_id: guildId });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/presence') {
    if (!authorizeApiAction(req, res, config, 'admin_command')) return true;
    const status = String(parsed['status'] ?? 'online');
    const activityType = String(parsed['activity_type'] ?? '');
    const activityName = String(parsed['activity_name'] ?? '');
    try {
      if (!deps.client?.user) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const validStatuses = ['online', 'idle', 'dnd', 'invisible'] as const;
      const resolvedStatus = validStatuses.includes(status as any)
        ? (status as typeof validStatuses[number])
        : 'online';
      const activityTypeMap: Record<string, number> = {
        playing: ActivityType.Playing,
        watching: ActivityType.Watching,
        listening: ActivityType.Listening,
        competing: ActivityType.Competing,
      };
      const activities = activityName
        ? [{ name: activityName, type: activityTypeMap[activityType] ?? ActivityType.Playing }]
        : [];
      deps.client.user.setPresence({ status: resolvedStatus, activities });
      respond(res, 200, { ok: true, status: resolvedStatus, activities });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
