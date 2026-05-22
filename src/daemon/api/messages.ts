import * as http from 'node:http';
import { chunkMessage } from '../../shared/chunker.js';
import { sendDiscordMessage } from '../sender.js';
import { resolveDiscoveredChannel } from '../channels.js';
import {
  respond,
  authorizeApiAction,
  resolveConversationSessionKey,
  resolveSendChannelId,
  fetchTextChannel,
  isWritableTarget,
  type ApiDependencies,
} from '../api-utils.js';

export async function handleMessageRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  parsed: Record<string, unknown>,
  deps: ApiDependencies,
): Promise<boolean> {
  const { config, memory, extensionDir } = deps;

  if (pathname === '/send') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
    const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
    const content = String(parsed['content'] ?? '');
    const files = Array.isArray(parsed['files']) ? parsed['files'].map(String) : undefined;

    if (!content.trim() && (!files || files.length === 0)) {
      respond(res, 400, { error: 'content or files are required' });
      return true;
    }

    let channelId = '';
    try {
      channelId = resolveSendChannelId(requestedChannelId);
      if (!requestedChannelId && requestedChannelName) {
        if (!deps.client) {
          respond(res, 503, { error: 'Client not ready' });
          return true;
        }
        const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client, config);
        if (!resolved) {
          respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
          return true;
        }
        channelId = resolved.id;
      }
      if (!channelId) {
        respond(res, 400, {
          error: 'No proven Discord target is available. Provide channel_id or channel_name explicitly.',
        });
        return true;
      }
      if (!deps.client) {
        respond(res, 503, {
          error: 'Client not ready',
          ...(channelId ? { channel_id: channelId } : {}),
        });
        return true;
      }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) {
        respond(res, 400, { error: 'Channel is not text-based', channel_id: channelId });
        return true;
      }
      if (!isWritableTarget(channelId, channel, config)) {
        respond(res, 403, { error: `Channel ${channelId} is not allowed for sending`, channel_id: channelId });
        return true;
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
    return true;
  }

  if (pathname === '/reply') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    const content = String(parsed['content'] ?? '');
    const files = Array.isArray(parsed['files']) ? parsed['files'].map(String) : undefined;

    if (!channelId || !messageId || (!content.trim() && (!files || files.length === 0))) {
      respond(res, 400, { error: 'channel_id, message_id, and either content or files are required' });
      return true;
    }

    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) {
        respond(res, 400, { error: 'Channel is not text-based' });
        return true;
      }
      if (!isWritableTarget(channelId, channel, config)) {
        respond(res, 403, { error: `Channel ${channelId} is not allowed for replies` });
        return true;
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
    return true;
  }

  if (pathname === '/react') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    const emoji = String(parsed['emoji'] ?? '');
    if (!channelId || !messageId || !emoji) {
      respond(res, 400, { error: 'channel_id, message_id, and emoji are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
      const msg = await channel.messages.fetch(messageId);
      await msg.react(emoji);
      respond(res, 200, { ok: true });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/unreact') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    const emoji = parsed['emoji'] == null ? '' : String(parsed['emoji']);
    if (!channelId || !messageId) {
      respond(res, 400, { error: 'channel_id and message_id are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
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
    return true;
  }

  if (pathname === '/edit') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    const content = String(parsed['content'] ?? '');
    if (!channelId || !messageId || !content.trim()) {
      respond(res, 400, { error: 'channel_id, message_id, and content are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
      const msg = await channel.messages.fetch(messageId);
      if (msg.author.id !== deps.client.user?.id) {
        respond(res, 403, { error: 'Can only edit own messages' });
        return true;
      }
      await msg.edit(content);
      respond(res, 200, { ok: true });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/delete') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    if (!channelId || !messageId) {
      respond(res, 400, { error: 'channel_id and message_id are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
      const msg = await channel.messages.fetch(messageId);
      if (msg.author.id !== deps.client.user?.id) {
        respond(res, 403, { error: 'Can only delete own messages' });
        return true;
      }
      await msg.delete();
      respond(res, 200, { ok: true });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/pin') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    if (!channelId || !messageId) {
      respond(res, 400, { error: 'channel_id and message_id are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
      const msg = await channel.messages.fetch(messageId);
      await msg.pin();
      respond(res, 200, { ok: true });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/unpin') {
    if (!authorizeApiAction(req, res, config, 'outbound_discord')) return true;
    const channelId = String(parsed['channel_id'] ?? '');
    const messageId = String(parsed['message_id'] ?? '');
    if (!channelId || !messageId) {
      respond(res, 400, { error: 'channel_id and message_id are required' });
      return true;
    }
    try {
      if (!deps.client) { respond(res, 503, { error: 'Client not ready' }); return true; }
      const channel = await fetchTextChannel(deps.client, channelId);
      if (!channel) { respond(res, 400, { error: 'Channel is not text-based' }); return true; }
      const msg = await channel.messages.fetch(messageId);
      await msg.unpin();
      respond(res, 200, { ok: true });
    } catch (err) {
      respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
