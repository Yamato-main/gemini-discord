/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Provides /health, /status, /history, /send, /reply, /reset endpoints.
 */

import * as http from 'node:http';
import { ActivityType } from 'discord.js';
import type {
  Config,
} from '../shared/types.js';
import { chunkMessage } from '../shared/chunker.js';
import { log } from './log.js';
import { sendDiscordMessage } from './sender.js';
import { scheduleJob, scheduleReminder, deleteJob } from './cron.js';
import { resolveDiscoveredChannel } from './channels.js';
import { resetConversationSession } from './session-reset.js';
import { resolveDmUserIdForChannel } from './dm-pairing.js';
import {
  respond,
  requireAuth,
  readBody,
  parseOptionalNumber,
  parseOptionalTimestamp,
  authorizeApiAction,
  resolveConversationSessionKey,
  resolveSendChannelId,
  fetchTextChannel,
  isWritableTarget,
  type ApiDependencies,
} from './api-utils.js';
import { handleStatusRoutes } from './api/status.js';
import { handleDiscoveryRoutes } from './api/discovery.js';

const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;

export {
  respond,
  requireAuth,
  readBody,
  parseOptionalNumber,
  parseOptionalTimestamp,
  authorizeApiAction,
  resolveConversationSessionKey,
  resolveSendChannelId,
  fetchTextChannel,
  isWritableTarget,
  type DaemonState,
  type ApiDependencies,
} from './api-utils.js';

export function startControlApi(deps: ApiDependencies): http.Server {
  const { config, memory, extensionDir, isShuttingDown, shutdown } = deps;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && isShuttingDown() && req.url !== '/shutdown') {
        respond(res, 503, { error: 'shutting down' });
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost:${config.daemonPort}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        respond(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/shutdown') {
        if (!requireAuth(req, config)) {
          respond(res, 401, { error: 'Unauthorized' });
          return;
        }
        if (!authorizeApiAction(req, res, config, 'admin_command')) return;
        respond(res, 200, { ok: true, message: 'Shutdown initiated' });
        // Give the response a moment to send before killing the process
        setTimeout(() => shutdown('API'), 500);
        return;
      }

      if (handleStatusRoutes(req, res, url, deps)) return;
      if (await handleDiscoveryRoutes(req, res, url, deps)) return;

      if (req.method === 'POST') {
        if (!requireAuth(req, config)) {
          respond(res, 401, { error: 'Unauthorized' });
          return;
        }

        let body: string;
        try {
          body = await readBody(req);
        } catch {
          respond(res, 413, { error: 'Payload too large (max 10KB)' });
          return;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(body);
        } catch {
          respond(res, 400, { error: 'Invalid JSON' });
          return;
        }

        if (pathname === '/send') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
          const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
          const content = String(parsed['content'] ?? '');
          const files = Array.isArray(parsed['files']) ? parsed['files'].map(String) : undefined;

          if (!content.trim() && (!files || files.length === 0)) {
            respond(res, 400, { error: 'content or files are required' });
            return;
          }

          let channelId = '';
          try {
            channelId = resolveSendChannelId(requestedChannelId);
            if (!requestedChannelId && requestedChannelName) {
              if (!deps.client) {
                respond(res, 503, { error: 'Client not ready' });
                return;
              }
              const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client, config);
              if (!resolved) {
                respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
                return;
              }
              channelId = resolved.id;
            }
            if (!channelId) {
              respond(res, 400, {
                error: 'No proven Discord target is available. Provide channel_id or channel_name explicitly.',
              });
              return;
            }
            if (!deps.client) {
              respond(res, 503, {
                error: 'Client not ready',
                ...(channelId ? { channel_id: channelId } : {}),
              });
              return;
            }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) {
              respond(res, 400, { error: 'Channel is not text-based', channel_id: channelId });
              return;
            }
            if (!isWritableTarget(channelId, channel, config)) {
              respond(res, 403, { error: `Channel ${channelId} is not allowed for sending`, channel_id: channelId });
              return;
            }

            const silent = parsed['silent'] === true;
            const messageIds = await sendDiscordMessage(channel, content, chunkMessage, { files, silent });

            const sessionKey = resolveConversationSessionKey(
              config,
              extensionDir,
              channelId,
              (channel as any).guildId ?? null,
            );
            const attachments = files?.map(f => ({ name: f.split('/').pop() || 'unknown_file' })) || [];
            memory.add(sessionKey, {
              role: 'assistant',
              content: content || '(Sent an attachment)',
              speakerKind: 'assistant',
              authorId: deps.client.user?.id,
              authorName: deps.client.user?.tag ?? 'Assistant',
              channelId: channel.id,
              channelName: (channel as any).name ?? 'dm',
              guildId: (channel as any).guildId ?? null,
              guildName: (channel as any).guild?.name ?? null,
              messageId: messageIds[0] ?? undefined,
              trigger: 'tool_send',
              createdAt: new Date().toISOString(),
              attachments
            });

            respond(res, 200, { ok: true, chunks: messageIds.length, messageIds, channel_id: channelId });
          } catch (err) {
            respond(res, 500, {
              error: err instanceof Error ? err.message : String(err),
              ...(channelId ? { channel_id: channelId } : {}),
            });
          }
          return;
        }

        if (pathname === '/reply') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          const content = String(parsed['content'] ?? '');
          const files = Array.isArray(parsed['files']) ? parsed['files'].map(String) : undefined;

          if (!channelId || !messageId || (!content.trim() && (!files || files.length === 0))) {
            respond(res, 400, { error: 'channel_id, message_id, and either content or files are required' });
            return;
          }

          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) {
              respond(res, 400, { error: 'Channel is not text-based' });
              return;
            }
            if (!isWritableTarget(channelId, channel, config)) {
              respond(res, 403, { error: `Channel ${channelId} is not allowed for replies` });
              return;
            }

            const msg = await channel.messages.fetch(messageId);
            const silent = parsed['silent'] === true;
            const messageIds = await sendDiscordMessage(channel, content, chunkMessage, { replyTo: msg, files, silent });

            const sessionKey = resolveConversationSessionKey(
              config,
              extensionDir,
              channelId,
              (channel as any).guildId ?? null,
            );
            const attachments = files?.map(f => ({ name: f.split('/').pop() || 'unknown_file' })) || [];
            memory.add(sessionKey, {
              role: 'assistant',
              content: content || '(Sent an attachment)',
              speakerKind: 'assistant',
              authorId: deps.client.user?.id,
              authorName: deps.client.user?.tag ?? 'Assistant',
              channelId: channel.id,
              channelName: (channel as any).name ?? 'dm',
              guildId: (channel as any).guildId ?? null,
              guildName: (channel as any).guild?.name ?? null,
              messageId: messageIds[0] ?? undefined,
              replyToMessageId: msg.id,
              replyToAuthorId: msg.author.id,
              replyToAuthorName: msg.author.tag,
              trigger: 'tool_reply',
              createdAt: new Date().toISOString(),
              attachments
            });

            respond(res, 200, { ok: true, messageIds });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/reset') {
          if (!authorizeApiAction(req, res, config, 'session_reset')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          if (!channelId) {
            respond(res, 400, { error: 'channel_id is required for reset' });
            return;
          }
          const guildId = parsed['guild_id'] == null ? null : String(parsed['guild_id']);
          const authorId = guildId ? null : resolveDmUserIdForChannel(extensionDir, channelId);
          resetConversationSession(config, memory, extensionDir, { channelId, guildId, authorId });
          respond(res, 200, { ok: true });
          return;
        }

        if (pathname === '/cron') {
          if (!authorizeApiAction(req, res, config, 'cron')) return;
          const cronExpression = String(parsed['cron_expression'] ?? '');
          const legacyInstruction = String(parsed['instruction'] ?? '');
          const message = String(parsed['message'] ?? legacyInstruction);
          const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
          const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
          const authorId = String(parsed['author_id'] ?? config.discordBossUserId);
          const runOnce = parsed['run_once'] === undefined ? true : parsed['run_once'] === true;
          const delayMinutes = parseOptionalNumber(parsed['delay_minutes']);
          const deliverAt = parseOptionalTimestamp(parsed['deliver_at']);

          if (!message || (!cronExpression && delayMinutes === null && deliverAt === null)) {
            respond(res, 400, { error: 'message plus cron_expression, delay_minutes, or deliver_at is required' });
            return;
          }

          try {
            let channelId = requestedChannelId;
            if (!requestedChannelId && requestedChannelName && deps.client) {
              const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client, config);
              if (!resolved) {
                respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
                return;
              }
              channelId = resolved.id;
            }

            if (!channelId) {
              respond(res, 400, {
                error: 'No proven Discord target is available. Provide channel_id or channel_name explicitly.',
              });
              return;
            }

            const jobId = cronExpression
              ? scheduleJob({
                cronExpression,
                message,
                channelId,
                authorId,
                runOnce,
              })
              : scheduleReminder({
                message,
                channelId,
                authorId,
                delayMinutes: delayMinutes ?? undefined,
                runAt: deliverAt ?? undefined,
              });
            respond(res, 200, { ok: true, job_id: jobId });
          } catch (err) {
            respond(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/cron/delete') {
          if (!authorizeApiAction(req, res, config, 'cron')) return;
          const jobId = String(parsed['job_id'] ?? '');
          if (!jobId) {
            respond(res, 400, { error: 'job_id is required' });
            return;
          }
          const ok = deleteJob(jobId);
          respond(res, 200, { ok });
          return;
        }

        if (pathname === '/react') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          const emoji = String(parsed['emoji'] ?? '');
          if (!channelId || !messageId || !emoji) {
            respond(res, 400, { error: 'channel_id, message_id, and emoji are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            await msg.react(emoji);
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/unreact') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          const emoji = parsed['emoji'] == null ? '' : String(parsed['emoji']);
          if (!channelId || !messageId) {
            respond(res, 400, { error: 'channel_id and message_id are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            if (emoji) {
              const reaction = msg.reactions.cache.find(
                r => r.emoji.name === emoji || r.emoji.toString() === emoji,
              );
              if (reaction) await reaction.users.remove(deps.client.user!.id);
            } else {
              for (const reaction of msg.reactions.cache.values()) {
                if (reaction.users.cache.has(deps.client.user!.id)) {
                  await reaction.users.remove(deps.client.user!.id);
                }
              }
            }
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/edit') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          const content = String(parsed['content'] ?? '');
          if (!channelId || !messageId || !content.trim()) {
            respond(res, 400, { error: 'channel_id, message_id, and content are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            if (msg.author.id !== deps.client.user?.id) {
              respond(res, 403, { error: 'Can only edit own messages' });
              return;
            }
            await msg.edit(content);
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/delete') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          if (!channelId || !messageId) {
            respond(res, 400, { error: 'channel_id and message_id are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            if (msg.author.id !== deps.client.user?.id) {
              respond(res, 403, { error: 'Can only delete own messages' });
              return;
            }
            await msg.delete();
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/pin') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          if (!channelId || !messageId) {
            respond(res, 400, { error: 'channel_id and message_id are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            await msg.pin();
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/unpin') {
          if (!authorizeApiAction(req, res, config, 'outbound_discord')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          if (!channelId || !messageId) {
            respond(res, 400, { error: 'channel_id and message_id are required' });
            return;
          }
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            await msg.unpin();
            respond(res, 200, { ok: true });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/moderation') {
          if (!authorizeApiAction(req, res, config, 'moderation')) return;
          const action = String(parsed['action'] ?? '');
          const userId = String(parsed['user_id'] ?? '').trim();
          const guildId = String(parsed['guild_id'] ?? config.discordServerId ?? '').trim();
          const reason = parsed['reason'] == null ? undefined : String(parsed['reason']);
          const durationMinutes = parseOptionalNumber(parsed['duration_minutes']);

          if (!['kick', 'timeout', 'remove_timeout'].includes(action)) {
            respond(res, 400, { error: 'action must be kick, timeout, or remove_timeout' });
            return;
          }
          if (!userId) {
            respond(res, 400, { error: 'user_id is required' });
            return;
          }
          if (!DISCORD_SNOWFLAKE_RE.test(userId)) {
            respond(res, 400, { error: 'user_id must be a stable numeric Discord user ID. Use user discovery to resolve names or mentions first.' });
            return;
          }
          if (!guildId) {
            respond(res, 400, { error: 'guild_id is required because no Discord server is configured' });
            return;
          }
          if (userId === deps.client?.user?.id) {
            respond(res, 400, { error: 'Refusing to moderate the bot user' });
            return;
          }
          if (config.discordBossUserId && userId === config.discordBossUserId) {
            respond(res, 400, { error: 'Refusing to moderate the configured authorized Discord user' });
            return;
          }
          if (action === 'timeout') {
            if (durationMinutes === null || durationMinutes <= 0) {
              respond(res, 400, { error: 'duration_minutes must be greater than 0 for timeout' });
              return;
            }
            if (durationMinutes > 40320) {
              respond(res, 400, { error: 'duration_minutes cannot exceed 40320 minutes (28 days)' });
              return;
            }
          }

          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
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
          return;
        }

        if (pathname === '/presence') {
          if (!authorizeApiAction(req, res, config, 'admin_command')) return;
          const status = String(parsed['status'] ?? 'online');
          const activityType = String(parsed['activity_type'] ?? '');
          const activityName = String(parsed['activity_name'] ?? '');
          try {
            if (!deps.client?.user) { respond(res, 503, { error: 'Client not ready' }); return; }
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
          return;
        }

}

      respond(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error('Control API error', { error: err instanceof Error ? err.message : String(err) });
      respond(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(config.daemonPort, '127.0.0.1', () => {
    log.info('Control API listening', { port: config.daemonPort, host: '127.0.0.1' });
  });

  return server;
}
