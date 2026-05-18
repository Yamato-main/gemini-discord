/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Provides /health, /status, /history, /send, /reply, /reset endpoints.
 */

import * as http from 'node:http';
import { ActivityType, type Client, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import type {
  Config,
  DaemonHistory,
  DaemonStatus,
  ExchangeLog,
} from '../shared/types.js';
import { chunkMessage } from '../shared/chunker.js';
import { log } from './log.js';
import type { ConversationMemory } from './memory.js';
import { resolveSessionKey } from './memory.js';
import type { ChannelQueue } from './queue.js';
import { sendDiscordMessage } from './sender.js';
import { scheduleJob, scheduleReminder, listJobs, deleteJob } from './cron.js';
import { getChannelMapEntries, resolveDiscoveredChannel } from './channels.js';
import { buildGuildUserMap, getUserMapEntries, resolveDiscoveredUser } from './users.js';
import { resetConversationSession } from './session-reset.js';
import { listGeminiBindingStates } from './binding.js';
import { listDmPairings, resolveDmUserIdForChannel } from './dm-pairing.js';
import {
  authorizeAction,
  formatPermissionDenial,
  GUEST_PERMISSION_REFUSAL,
  resolveDiscordRole,
  type PermissionAction,
  type RoleContext,
} from './permissions.js';

const MAX_BODY_BYTES = 10240;
const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;

export interface DaemonState {
  status: 'starting' | 'ready' | 'degraded';
  startedAt: string;
  geminiReachable: boolean;
  geminiVersion: string;
  messagesHandled: number;
  lastMessageAt: string | null;
  lastError: string | null;
  exchangeLog: ExchangeLog[];
}

export interface ApiDependencies {
  config: Config;
  state: DaemonState;
  memory: ConversationMemory;
  queue: ChannelQueue;
  extensionDir: string;
  client?: import('discord.js').Client | null;
  isShuttingDown: () => boolean;
  shutdown: (signal: string) => Promise<void>;
}

export function startControlApi(deps: ApiDependencies): http.Server {
  const { config, state, memory, queue, extensionDir, isShuttingDown, shutdown } = deps;

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

      if (req.method === 'GET' && pathname === '/status') {
        if (!authorizeApiAction(req, res, config, 'status')) return;
        const queueKey = config.discordChannelId ? `memory:channel:${config.discordChannelId}` : 'memory:none';
        const statusBody: DaemonStatus = {
          status: state.status,
          startedAt: state.startedAt,
          geminiReachable: state.geminiReachable,
          geminiVersion: state.geminiVersion,
          messagesHandled: state.messagesHandled,
          lastMessageAt: state.lastMessageAt,
          lastError: state.lastError,
          queueDepth: queue.depth(queueKey),
          streaming: config.streaming,
          botTag: deps.client?.user?.tag ?? null,
          wsPing: deps.client?.ws?.ping ?? -1,
          channelId: config.discordChannelId,
          serverId: config.discordServerId || undefined,
          serverName: config.discordServerName || undefined,
          ownerIds: config.ownerIds,
          enableDMs: config.enableDMs,
          sessionScope: config.memoryScope,
          geminiSessionBindingScope: config.geminiSessionBindingScope,
          useGeminiCliSessions: config.useGeminiCliSessions,
          allowlistedUsers: config.allowedUserIds.length,
          allowlistedAgents: config.allowedAgentIds.length,
          requireMention: config.requireMention,
          channels: getChannelMapEntries().map(([name, { id }]) => ({ name, id })),
          cronJobs: listJobs(),
          headlessMode: config.useGeminiCliSessions ? 'gemini-cli ACP persistent sessions (discord-only extension load)' : 'stateless prompt replay',
          bindings: listGeminiBindingStates(extensionDir),
          dmPairings: listDmPairings(extensionDir),
        };
        respond(res, 200, statusBody);
        return;
      }

      if (req.method === 'GET' && pathname === '/history') {
        if (!authorizeApiAction(req, res, config, 'history')) return;
        const channelId = url.searchParams.get('channel_id');
        const scope = url.searchParams.get('scope') ?? 'current';
        if (!channelId) {
          respond(res, 400, { error: 'channel_id is required for history' });
          return;
        }
        const resolvedChannelId = channelId;
        const sessionKey = resolveConversationSessionKey(config, extensionDir, resolvedChannelId, null);
        const filteredMessages = channelId
          ? state.exchangeLog.filter((entry) => entry.channelId === channelId).slice(-30)
          : state.exchangeLog.slice(-30);

        const historyBody: DaemonHistory = {
          sessionKey,
          messages: filteredMessages,
          conversation: scope === 'archived' ? [] : memory.snapshot(sessionKey),
          archives: scope === 'current' ? [] : memory.archivedSessions(sessionKey),
          participants: memory.participants(sessionKey),
          channels: memory.channels(sessionKey),
        };
        respond(res, 200, historyBody);
        return;
      }

      if (req.method === 'GET' && pathname === '/cron') {
        if (!authorizeApiAction(req, res, config, 'cron')) return;
        respond(res, 200, { ok: true, jobs: listJobs() });
        return;
      }

      if (req.method === 'GET' && pathname === '/users') {
        if (!authorizeApiAction(req, res, config, 'user_discovery')) return;
        if (!deps.client) {
          respond(res, 503, { error: 'Client not ready' });
          return;
        }

        const query = url.searchParams.get('query') ?? '';
        await buildGuildUserMap(deps.client, config, query ? { query, limit: 25 } : undefined);
        const resolved = query ? await resolveDiscoveredUser(query, deps.client, config) : null;
        const users = getUserMapEntries(config.discordServerId || undefined)
          .filter((entry) => {
            if (!query.trim()) return true;
            const needle = query.trim().toLowerCase();
            return entry.id.includes(needle)
              || entry.username.toLowerCase().includes(needle)
              || (entry.displayName ?? '').toLowerCase().includes(needle)
              || (entry.globalName ?? '').toLowerCase().includes(needle)
              || (entry.tag ?? '').toLowerCase().includes(needle);
          })
          .slice(0, 50);
        respond(res, 200, { ok: true, users, resolved });
        return;
      }

      if (req.method === 'GET' && pathname === '/reactions') {
        if (!authorizeApiAction(req, res, config, 'history')) return;
        const channelId = url.searchParams.get('channel_id');
        const messageId = url.searchParams.get('message_id');
        const emoji = url.searchParams.get('emoji');
        if (!channelId || !messageId) {
          respond(res, 400, { error: 'channel_id and message_id are required' });
          return;
        }
        try {
          if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
          const channel = await fetchTextChannel(deps.client, channelId);
          if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
          const msg = await channel.messages.fetch(messageId);
          const reactions: Array<{ emoji: string; count: number; users: string[] }> = [];
          for (const [key, reaction] of msg.reactions.cache) {
            if (emoji && key !== emoji && reaction.emoji.name !== emoji) continue;
            const users = await reaction.users.fetch();
            reactions.push({
              emoji: reaction.emoji.toString(),
              count: reaction.count,
              users: users.map(u => u.id),
            });
          }
          respond(res, 200, { ok: true, reactions });
        } catch (err) {
          respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/pins') {
        if (!authorizeApiAction(req, res, config, 'history')) return;
        const channelId = url.searchParams.get('channel_id');
        if (!channelId) {
          respond(res, 400, { error: 'channel_id is required' });
          return;
        }
        try {
          if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
          const channel = await fetchTextChannel(deps.client, channelId);
          if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
          const pins = await channel.messages.fetchPinned();
          const pinList = pins.map(p => ({
            id: p.id,
            content: p.content.slice(0, 300),
            author: p.author.tag,
            authorId: p.author.id,
            pinnedAt: p.editedAt?.toISOString() ?? p.createdAt.toISOString(),
          }));
          respond(res, 200, { ok: true, pins: pinList });
        } catch (err) {
          respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

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

        if (pathname === '/reactions') {
          if (!authorizeApiAction(req, res, config, 'history')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const msg = await channel.messages.fetch(messageId);
            const reactions = msg.reactions.cache.map(r => ({ emoji: r.emoji.name, count: r.count }));
            respond(res, 200, { reactions });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/pins') {
          if (!authorizeApiAction(req, res, config, 'history')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return; }
            const pins = await channel.messages.fetchPinned();
            respond(res, 200, { pins: pins.map(p => ({ id: p.id, content: p.content })) });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
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

function respond(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireAuth(req: http.IncomingMessage, config: Config): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token === config.daemonApiToken;
}

function authorizeApiAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config,
  action: PermissionAction,
): boolean {
  const roleContext = roleContextFromRequest(req, config);
  if (!roleContext) {
    respond(res, 403, { error: GUEST_PERMISSION_REFUSAL });
    return false;
  }

  const decision = authorizeAction(action, roleContext);
  if (decision.decision === 'allow') {
    return true;
  }

  respond(res, 403, { error: formatPermissionDenial(decision) });
  return false;
}

function roleContextFromRequest(req: http.IncomingMessage, config: Config): RoleContext | null {
  const rawRole = req.headers['x-gemini-discord-role'];
  const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  if (role !== 'BOSS' && role !== 'GUEST') {
    return null;
  }

  const rawSenderId = req.headers['x-gemini-discord-sender-id'];
  const rawSenderLabel = req.headers['x-gemini-discord-sender-label'];
  const senderDiscordId = (Array.isArray(rawSenderId) ? rawSenderId[0] : rawSenderId)?.trim() || 'unknown';
  const senderDisplayLabel = (Array.isArray(rawSenderLabel) ? rawSenderLabel[0] : rawSenderLabel)?.trim() || senderDiscordId;

  return resolveDiscordRole(config, { discordUserId: senderDiscordId, displayLabel: senderDisplayLabel });
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalTimestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveConversationSessionKey(
  config: Config,
  extensionDir: string,
  channelId: string,
  guildId: string | null,
): string {
  if (guildId) {
    return resolveSessionKey('channel', channelId, null);
  }

  return resolveSessionKey(
    'channel',
    channelId,
    resolveDmUserIdForChannel(extensionDir, channelId),
  );
}

export function resolveSendChannelId(requestedChannelId: string): string {
  return requestedChannelId.trim();
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

type SendableChannel = TextChannel | DMChannel | NewsChannel;

async function fetchTextChannel(client: Client, channelId: string): Promise<SendableChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased() && 'send' in channel) return channel as SendableChannel;
  } catch {}
  
  try {
    const user = await client.users.fetch(channelId);
    if (user) return await user.createDM();
  } catch {}
  
  return null;
}

function isWritableTarget(channelId: string, channel: SendableChannel, config: Config): boolean {
  if ('isDMBased' in channel && channel.isDMBased()) {
    return config.enableDMs;
  }
  if (config.allowedChannelIds.includes(channelId)) {
    return true;
  }
  const parentId = (channel as { parentId?: string | null }).parentId ?? null;
  if (parentId && config.allowedChannelIds.includes(parentId)) {
    return true;
  }

  const guildId = (channel as { guildId?: string | null }).guildId ?? null;
  return config.allowedChannelIds.length === 0
    && Boolean(config.discordServerId)
    && guildId === config.discordServerId;
}
