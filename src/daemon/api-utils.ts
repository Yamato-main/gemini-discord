import * as http from 'node:http';
import { type Client, type TextChannel, type DMChannel, type NewsChannel } from 'discord.js';
import type {
  Config,
  ExchangeLog,
} from '../shared/types.js';
import { resolveSessionKey } from './memory.js';
import type { ConversationMemory } from './memory.js';
import type { ChannelQueue } from './queue.js';
import { resolveDmUserIdForChannel } from './dm-pairing.js';
import {
  authorizeAction,
  formatPermissionDenial,
  GUEST_PERMISSION_REFUSAL,
  resolveDiscordRole,
  type PermissionAction,
  type RoleContext,
} from './permissions.js';

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

export type SendableChannel = TextChannel | DMChannel | NewsChannel;

export function respond(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function requireAuth(req: http.IncomingMessage, config: Config): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token === config.daemonApiToken;
}

export async function readBody(req: http.IncomingMessage): Promise<string> {
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

export function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOptionalTimestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function roleContextFromRequest(req: http.IncomingMessage, config: Config): RoleContext | null {
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

export function authorizeApiAction(
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

export function resolveConversationSessionKey(
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

export async function fetchTextChannel(client: Client, channelId: string): Promise<SendableChannel | null> {
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

export function isWritableTarget(channelId: string, channel: SendableChannel, config: Config): boolean {
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
