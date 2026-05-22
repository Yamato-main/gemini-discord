import * as http from 'node:http';
import type { DaemonStatus, DaemonHistory } from '../../shared/types.js';
import { getChannelMapEntries } from '../channels.js';
import { listJobs } from '../cron.js';
import { listGeminiBindingStates } from '../binding.js';
import { listDmPairings } from '../dm-pairing.js';
import {
  respond,
  authorizeApiAction,
  resolveConversationSessionKey,
  type ApiDependencies,
} from '../api-utils.js';

export function handleStatusRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  deps: ApiDependencies,
): boolean {
  const pathname = url.pathname;
  const { config, state, memory, queue, extensionDir } = deps;

  if (req.method === 'GET' && pathname === '/status') {
    if (!authorizeApiAction(req, res, config, 'status')) return true;
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
    return true;
  }

  if (req.method === 'GET' && pathname === '/history') {
    if (!authorizeApiAction(req, res, config, 'history')) return true;
    const channelId = url.searchParams.get('channel_id');
    const scope = url.searchParams.get('scope') ?? 'current';
    if (!channelId) {
      respond(res, 400, { error: 'channel_id is required for history' });
      return true;
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
    return true;
  }

  return false;
}
