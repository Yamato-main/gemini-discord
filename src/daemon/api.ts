/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Provides /health, /status, /history, /send, /reply, /reset endpoints.
 */

import * as http from 'node:http';
import type { Client, TextChannel, DMChannel, NewsChannel } from 'discord.js';
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
import { resetConversationSession } from './session-reset.js';
import { listGeminiBindingStates } from './binding.js';
import { listDmPairings, resolveDmUserIdForChannel } from './dm-pairing.js';

const MAX_BODY_BYTES = 10240;

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
        respond(res, 200, { ok: true, message: 'Shutdown initiated' });
        // Give the response a moment to send before killing the process
        setTimeout(() => shutdown('API'), 500);
        return;
      }

      if (req.method === 'GET' && pathname === '/status') {
        const queueKey = config.memoryScope === 'global' ? 'global' : config.discordChannelId;
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
        const channelId = url.searchParams.get('channel_id');
        const scope = url.searchParams.get('scope') ?? 'current';
        const resolvedChannelId = channelId ?? config.discordChannelId;
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
        respond(res, 200, { ok: true, jobs: listJobs() });
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
          const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
          const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
          const content = String(parsed['content'] ?? '');
          const files = Array.isArray(parsed['files']) ? parsed['files'].map(String) : undefined;

          if (!content.trim() && (!files || files.length === 0)) {
            respond(res, 400, { error: 'content or files are required' });
            return;
          }

          try {
            if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return; }
            let channelId = requestedChannelId || config.discordChannelId;
            if (!requestedChannelId && requestedChannelName) {
              const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client);
              if (!resolved) {
                respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
                return;
              }
              channelId = resolved.id;
            }
            const channel = await fetchTextChannel(deps.client, channelId);
            if (!channel) {
              respond(res, 400, { error: 'Channel is not text-based' });
              return;
            }
            if (!isWritableTarget(channelId, channel, config)) {
              respond(res, 403, { error: `Channel ${channelId} is not allowed for sending` });
              return;
            }

            const messageIds = await sendDiscordMessage(channel, content, chunkMessage, { files });

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
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/reply') {
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
            const messageIds = await sendDiscordMessage(channel, content, chunkMessage, { replyTo: msg, files });

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
          const channelId = String(parsed['channel_id'] ?? config.discordChannelId);
          const guildId = parsed['guild_id'] == null ? null : String(parsed['guild_id']);
          const authorId = guildId ? null : resolveDmUserIdForChannel(extensionDir, channelId);
          resetConversationSession(config, memory, extensionDir, { channelId, guildId, authorId });
          respond(res, 200, { ok: true });
          return;
        }

        if (pathname === '/cron') {
          const cronExpression = String(parsed['cron_expression'] ?? '');
          const legacyInstruction = String(parsed['instruction'] ?? '');
          const message = String(parsed['message'] ?? legacyInstruction);
          const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
          const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
          const authorId = String(parsed['author_id'] ?? config.discordAdminId);
          const runOnce = parsed['run_once'] === undefined ? true : parsed['run_once'] === true;
          const delayMinutes = parseOptionalNumber(parsed['delay_minutes']);
          const deliverAt = parseOptionalTimestamp(parsed['deliver_at']);

          if (!message || (!cronExpression && delayMinutes === null && deliverAt === null)) {
            respond(res, 400, { error: 'message plus cron_expression, delay_minutes, or deliver_at is required' });
            return;
          }

          try {
            let channelId = requestedChannelId || config.discordChannelId;
            if (!requestedChannelId && requestedChannelName && deps.client) {
              const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client);
              if (!resolved) {
                respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
                return;
              }
              channelId = resolved.id;
            }

            if (!channelId) {
              respond(res, 400, {
                error: 'No primary Discord channel is configured yet. Provide channel_id/channel_name or let the daemon remember the first owner channel automatically.',
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
    const jobId = String(parsed['job_id'] ?? '');
    if (!jobId) {
      respond(res, 400, { error: 'job_id is required' });
      return;
    }
    const ok = deleteJob(jobId);
    respond(res, 200, { ok });
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
  if (config.memoryScope !== 'channel') {
    return 'global';
  }

  if (guildId) {
    return resolveSessionKey(config.memoryScope, channelId, null);
  }

  return resolveSessionKey(
    config.memoryScope,
    channelId,
    resolveDmUserIdForChannel(extensionDir, channelId),
  );
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
  return config.allowedChannelIds.includes(channelId);
}
