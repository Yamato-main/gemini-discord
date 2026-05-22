import * as http from 'node:http';
import { buildGuildUserMap, getUserMapEntries, resolveDiscoveredUser } from '../users.js';
import { resolveDiscoveredChannel } from '../channels.js';
import {
  respond,
  authorizeApiAction,
  fetchTextChannel,
  type ApiDependencies,
} from '../api-utils.js';

export async function handleDiscoveryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  deps: ApiDependencies,
): Promise<boolean> {
  const pathname = url.pathname;
  const { config } = deps;

  if (req.method === 'GET' && pathname === '/users') {
    if (!authorizeApiAction(req, res, config, 'user_discovery')) return true;
    if (!deps.client) {
      respond(res, 503, { error: 'Client not ready' });
      return true;
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
    return true;
  }

  if (req.method === 'GET' && pathname === '/reactions') {
    if (!authorizeApiAction(req, res, config, 'history')) return true;
    const channelId = url.searchParams.get('channel_id');
    const messageId = url.searchParams.get('message_id');
    const emoji = url.searchParams.get('emoji');
    if (!channelId || !messageId) {
      respond(res, 400, { error: 'channel_id and message_id are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
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
    return true;
  }

  if (req.method === 'GET' && pathname === '/pins') {
    if (!authorizeApiAction(req, res, config, 'history')) return true;
    const channelId = url.searchParams.get('channel_id');
    if (!channelId) {
      respond(res, 400, { error: 'channel_id is required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
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
    return true;
  }

  return false;
}
