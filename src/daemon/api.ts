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
import { scheduleJob, listJobs, deleteJob } from './cron.js';
import { getChannelMapEntries, resolveDiscoveredChannel } from './channels.js';
import { resetConversationSession } from './session-reset.js';
import { getAutonomousStatus } from './autonomous.js';
import { listGeminiBindingStates } from './binding.js';
import { listDmPairings } from './dm-pairing.js';
import { scheduleWatchJob, listWatchJobs, deleteWatchJob } from './watch-jobs.js';

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
          ownerIds: config.ownerIds,
          enableDMs: config.enableDMs,
          sessionScope: config.memoryScope,
          geminiSessionBindingScope: config.geminiSessionBindingScope,
          useGeminiCliSessions: config.useGeminiCliSessions,
          allowlistedUsers: config.allowedUserIds.length,
          allowlistedAgents: config.allowedAgentIds.length,
          requireMention: config.requireMention,
          channels: getChannelMapEntries().map(([name, { id }]) => ({ name, id })),
          autonomous: getAutonomousStatus(),
          cronJobs: listJobs(),
          watchJobs: listWatchJobs(),
          headlessMode: config.useGeminiCliSessions ? 'gemini-cli ACP persistent sessions (discord-only extension load)' : 'stateless prompt replay',
          bindings: listGeminiBindingStates(extensionDir),
          dmPairings: listDmPairings(extensionDir),
        };
        respond(res, 200, statusBody);
        return;
      }

      if (req.method === 'GET' && pathname === '/history') {
        const channelId = url.searchParams.get('channel_id');
        const sessionKey = resolveSessionKey(config.memoryScope, channelId ?? config.discordChannelId);
        const filteredMessages = channelId
          ? state.exchangeLog.filter((entry) => entry.channelId === channelId).slice(-30)
          : state.exchangeLog.slice(-30);

        const historyBody: DaemonHistory = {
          sessionKey,
          messages: filteredMessages,
          conversation: memory.snapshot(sessionKey),
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

      if (req.method === 'GET' && pathname === '/watch') {
        respond(res, 200, { ok: true, jobs: listWatchJobs() });
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

            const sessionKey = resolveSessionKey(config.memoryScope, channelId);
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

            const sessionKey = resolveSessionKey(config.memoryScope, channelId);
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
          resetConversationSession(config, memory, extensionDir, { channelId, guildId });
          respond(res, 200, { ok: true });
          return;
        }

        if (pathname === '/cron') {
          const cronExpression = String(parsed['cron_expression'] ?? '');
          const legacyInstruction = String(parsed['instruction'] ?? '');
          const message = String(parsed['message'] ?? legacyInstruction);
          const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
          const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
          const authorId = String(parsed['author_id'] ?? config.discordBossId);
          const runOnce = parsed['run_once'] === undefined ? true : parsed['run_once'] === true;

          if (!cronExpression || !message) {
            respond(res, 400, { error: 'cron_expression and message are required' });
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

            const jobId = scheduleJob({
              cronExpression,
              message,
              channelId,
              authorId,
              runOnce,
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

  if (pathname === '/watch') {
    const source = String(parsed['source'] ?? '4chan_a_watch');
    const topic = String(parsed['topic'] ?? '').trim();
    const board = String(parsed['board'] ?? 'a');
    const keywords = Array.isArray(parsed['keywords'])
      ? parsed['keywords'].map(String)
      : [];
    const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
    const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
    const authorId = String(parsed['author_id'] ?? config.discordBossId);
    const reportInMinutes = parsed['report_in_minutes'] == null ? undefined : Number(parsed['report_in_minutes']);
    const pollEveryMinutes = parsed['poll_every_minutes'] == null ? undefined : Number(parsed['poll_every_minutes']);
    const minSignal = parsed['min_signal'] == null ? undefined : Number(parsed['min_signal']);

    if (source !== '4chan_a_watch') {
      respond(res, 400, { error: `Unsupported watch source: ${source}` });
      return;
    }

    if (!topic || keywords.length === 0) {
      respond(res, 400, { error: 'topic and at least one keyword are required' });
      return;
    }

    try {
      let channelId = requestedChannelId || config.discordChannelId;
      let channelName = requestedChannelName;
      if (!requestedChannelId && requestedChannelName && deps.client) {
        const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client);
        if (!resolved) {
          respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
          return;
        }
        channelId = resolved.id;
        channelName = resolved.name;
      }

      if (deps.client) {
        const channel = await fetchTextChannel(deps.client, channelId);
        if (!channel) {
          respond(res, 400, { error: 'Channel is not text-based' });
          return;
        }
        if (!isWritableTarget(channelId, channel, config)) {
          respond(res, 403, { error: `Channel ${channelId} is not allowed for watch reports` });
          return;
        }
      }

      const job = scheduleWatchJob({
        topic,
        board,
        keywords,
        channelId,
        channelName,
        authorId,
        reportInMinutes,
        pollEveryMinutes,
        minSignal,
      });
      respond(res, 200, { ok: true, job });
    } catch (err) {
      respond(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (pathname === '/watch/delete') {
    const jobId = String(parsed['job_id'] ?? '');
    if (!jobId) {
      respond(res, 400, { error: 'job_id is required' });
      return;
    }
    const ok = deleteWatchJob(jobId);
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
