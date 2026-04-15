/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Provides /health, /status, /history, /send, /reply, /reset endpoints.
 */

import * as http from 'node:http';
import type { Client, TextBasedChannel } from 'discord.js';
import type {
  Config,
  DaemonHistory,
  DaemonStatus,
  ExchangeLog,
} from '../shared/types.js';
import { chunkMessage } from '../shared/chunker.js';
import { withRetry } from './retry.js';
import { log } from './log.js';
import type { ConversationMemory } from './memory.js';
import { resolveSessionKey } from './memory.js';
import type { ChannelQueue } from './queue.js';

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
  client: Client;
  isShuttingDown: () => boolean;
  shutdown: (signal: string) => Promise<void>;
}

export function startControlApi(deps: ApiDependencies): http.Server {
  const { config, state, memory, queue, client, isShuttingDown, shutdown } = deps;

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
          botTag: client.user?.tag ?? null,
          wsPing: client.ws.ping,
          channelId: config.discordChannelId,
          ownerIds: config.ownerIds,
          enableDMs: config.enableDMs,
          sessionScope: config.memoryScope,
          geminiSessionBindingScope: config.geminiSessionBindingScope,
          useGeminiCliSessions: config.useGeminiCliSessions,
          allowlistedUsers: config.allowedUserIds.length,
          allowlistedAgents: config.allowedAgentIds.length,
          requireMention: config.requireMention,
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
          const channelId = String(parsed['channel_id'] ?? config.discordChannelId);
          const content = String(parsed['content'] ?? '');

          if (!content.trim()) {
            respond(res, 400, { error: 'content is required' });
            return;
          }

          try {
            const channel = await fetchTextChannel(client, channelId);
            if (!channel) {
              respond(res, 400, { error: 'Channel is not text-based' });
              return;
            }
            if (!isWritableTarget(channelId, channel, config)) {
              respond(res, 403, { error: `Channel ${channelId} is not allowed for sending` });
              return;
            }

            const chunks = chunkMessage(content);
            const messageIds: string[] = [];
            for (const chunk of chunks) {
              const sent = await withRetry(() => channel.send(chunk));
              messageIds.push(sent.id);
            }
            respond(res, 200, { ok: true, chunks: chunks.length, messageIds });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/reply') {
          const channelId = String(parsed['channel_id'] ?? '');
          const messageId = String(parsed['message_id'] ?? '');
          const content = String(parsed['content'] ?? '');

          if (!channelId || !messageId || !content.trim()) {
            respond(res, 400, { error: 'channel_id, message_id, and content are required' });
            return;
          }

          try {
            const channel = await fetchTextChannel(client, channelId);
            if (!channel) {
              respond(res, 400, { error: 'Channel is not text-based' });
              return;
            }
            if (!isWritableTarget(channelId, channel, config)) {
              respond(res, 403, { error: `Channel ${channelId} is not allowed for replies` });
              return;
            }

            const msg = await channel.messages.fetch(messageId);
            const chunks = chunkMessage(content);
            const first = await withRetry(() => msg.reply(chunks[0]));
            const messageIds = [first.id];
            for (const chunk of chunks.slice(1)) {
              const sent = await withRetry(() => channel.send(chunk));
              messageIds.push(sent.id);
            }
            respond(res, 200, { ok: true, messageIds });
          } catch (err) {
            respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (pathname === '/reset') {
          const channelId = String(parsed['channel_id'] ?? config.discordChannelId);
          memory.reset(resolveSessionKey(config.memoryScope, channelId));
          respond(res, 200, { ok: true });
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

async function fetchTextChannel(client: Client, channelId: string): Promise<TextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId);
  return channel && channel.isTextBased() ? channel : null;
}

function isWritableTarget(channelId: string, channel: TextBasedChannel, config: Config): boolean {
  if ('isDMBased' in channel && channel.isDMBased()) {
    return config.enableDMs;
  }
  return config.allowedChannelIds.includes(channelId);
}
