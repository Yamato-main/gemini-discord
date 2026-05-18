import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../shared/types.js';
import { daemonRequest } from './client.js';
import { authorizeMcpToolAction, formatPermissionDenial } from '../daemon/permissions.js';
import {
  clearPendingDelivery,
  pendingDeliveryFailureText,
  recordPendingDelivery,
} from './pending-delivery.js';

export function registerMessageTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_message',
    [
      'Interact with Discord messages. Actions:',
      '• "send" — send a new message to an explicit channel_id or channel_name (use silent:true to suppress notifications)',
      '• "reply" — reply to a specific message ID',
      '• "edit" — edit a bot-owned message',
      '• "delete" — delete a bot-owned message',
      '• "react" — add a reaction (only when the reaction conveys specific meaning: acknowledgment, approval, flagging. Do not react for decoration)',
      '• "unreact" — remove own reaction(s)',
      '• "fetch_reactions" — list reactions on a message',
      '• "pin" — pin a message',
      '• "unpin" — unpin a message',
      '• "list_pins" — list pinned messages in a channel',
    ].join('\n'),
    {
      action: z.enum([
        'send', 'reply', 'edit', 'delete',
        'react', 'unreact', 'fetch_reactions',
        'pin', 'unpin', 'list_pins',
      ]).describe('Action to perform'),
      content: z.string().optional().describe('Message text. For "send"/"reply": optional text to accompany files (your normal conversational response streams automatically). For "edit": the new message content.'),
      channel_id: z.string().optional().describe('Target channel ID. Required for send unless channel_name is provided. Required for most other actions.'),
      channel_name: z.string().optional().describe('Target channel name (only used for "send").'),
      message_id: z.string().optional().describe('Message ID (required for reply/edit/delete/react/unreact/fetch_reactions/pin/unpin).'),
      files: z.array(z.string()).optional().describe('Optional array of absolute file paths to attach (send/reply only)'),
      emoji: z.string().optional().describe('Emoji for react/unreact (e.g. "✅", "👍", "🔥"). Omit emoji on unreact to remove all own reactions.'),
      silent: z.boolean().optional().default(false).describe('If true, suppress Discord push notifications for this message. Off by default.'),
    },
    async ({ action, content = '', channel_id, channel_name, message_id, files, emoji, silent }) => {
      const gate = authorizeMcpToolAction('outbound_discord', config);
      if (gate.decision !== 'allow') {
        return text(formatPermissionDenial(gate), true);
      }

      // --- Send ---
      if (action === 'send') {
        if (!channel_id && !channel_name) {
          return text('❌ Error: channel_id or channel_name is required for send action.', true);
        }
        const body: Record<string, unknown> = { content, files };
        if (channel_id) body['channel_id'] = channel_id;
        if (channel_name) body['channel_name'] = channel_name;
        if (silent) body['silent'] = true;

        const res = await daemonRequest({
          method: 'POST',
          path: '/send',
          config,
          body,
          timeoutMs: 60000,
        });

        if (!res.ok) {
          const error = String(res.data['error'] ?? 'unknown error');
          recordPendingDelivery('send', pendingSendBody(body, res.data), error);
          return text(pendingDeliveryFailureText('Send', error), true);
        }

        clearPendingDelivery('send', body);
        clearPendingDelivery('send', pendingSendBody(body, res.data));
        const chunks = (res.data['chunks'] as number) ?? 1;
        const resolvedChannel = String(res.data['channel_id'] ?? channel_id ?? channel_name ?? 'current conversation');
        return text(`✅ Sent (${chunks} chunk${chunks > 1 ? 's' : ''}) to channel ${resolvedChannel}.`);
      }

      // --- Reply ---
      if (action === 'reply') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required for reply action.', true);
        }
        const body: Record<string, unknown> = { content, channel_id, message_id, files };
        if (silent) body['silent'] = true;

        const res = await daemonRequest({
          method: 'POST',
          path: '/reply',
          config,
          body,
          timeoutMs: 60000,
        });

        if (!res.ok) {
          const error = String(res.data['error'] ?? 'unknown error');
          recordPendingDelivery('reply', body, error);
          return text(pendingDeliveryFailureText('Reply', error), true);
        }

        clearPendingDelivery('reply', body);
        return text('✅ Reply sent with the attached content/files.');
      }

      // --- Edit ---
      if (action === 'edit') {
        if (!channel_id || !message_id || !content.trim()) {
          return text('❌ Error: channel_id, message_id, and content are required for edit.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/edit',
          config,
          body: { channel_id, message_id, content },
        });
        if (!res.ok) return text(`❌ Edit failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text('✅ Message edited.');
      }

      // --- Delete ---
      if (action === 'delete') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required for delete.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/delete',
          config,
          body: { channel_id, message_id },
        });
        if (!res.ok) return text(`❌ Delete failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text('✅ Message deleted.');
      }

      // --- React ---
      if (action === 'react') {
        if (!channel_id || !message_id || !emoji) {
          return text('❌ Error: channel_id, message_id, and emoji are required for react.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/react',
          config,
          body: { channel_id, message_id, emoji },
        });
        if (!res.ok) return text(`❌ React failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text(`✅ Reacted with ${emoji}.`);
      }

      // --- Unreact ---
      if (action === 'unreact') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required for unreact.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/unreact',
          config,
          body: { channel_id, message_id, ...(emoji ? { emoji } : {}) },
        });
        if (!res.ok) return text(`❌ Unreact failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text(emoji ? `✅ Removed ${emoji} reaction.` : '✅ Removed all own reactions.');
      }

      // --- Fetch Reactions ---
      if (action === 'fetch_reactions') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required.', true);
        }
        const params = new URLSearchParams({ channel_id, message_id });
        if (emoji) params.set('emoji', emoji);
        const res = await daemonRequest({
          method: 'GET',
          path: `/reactions?${params.toString()}`,
          config,
        });
        if (!res.ok) return text(`❌ Fetch reactions failed: ${res.data['error'] ?? 'unknown error'}`, true);
        const reactions = res.data['reactions'] as Array<{ emoji: string; count: number; users: string[] }>;
        if (!reactions || reactions.length === 0) return text('No reactions on this message.');
        const lines = reactions.map(r => `${r.emoji} × ${r.count} — users: ${r.users.join(', ')}`);
        return text(lines.join('\n'));
      }

      // --- Pin ---
      if (action === 'pin') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required for pin.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/pin',
          config,
          body: { channel_id, message_id },
        });
        if (!res.ok) return text(`❌ Pin failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text('✅ Message pinned.');
      }

      // --- Unpin ---
      if (action === 'unpin') {
        if (!channel_id || !message_id) {
          return text('❌ Error: channel_id and message_id are required for unpin.', true);
        }
        const res = await daemonRequest({
          method: 'POST',
          path: '/unpin',
          config,
          body: { channel_id, message_id },
        });
        if (!res.ok) return text(`❌ Unpin failed: ${res.data['error'] ?? 'unknown error'}`, true);
        return text('✅ Message unpinned.');
      }

      // --- List Pins ---
      if (action === 'list_pins') {
        if (!channel_id) {
          return text('❌ Error: channel_id is required for list_pins.', true);
        }
        const res = await daemonRequest({
          method: 'GET',
          path: `/pins?channel_id=${encodeURIComponent(channel_id)}`,
          config,
        });
        if (!res.ok) return text(`❌ List pins failed: ${res.data['error'] ?? 'unknown error'}`, true);
        const pins = res.data['pins'] as Array<{ id: string; content: string; author: string; authorId: string; pinnedAt: string }>;
        if (!pins || pins.length === 0) return text('No pinned messages in this channel.');
        const lines = pins.map(p => `📌 **${p.author}** (${p.pinnedAt}): ${p.content}`);
        return text(lines.join('\n'));
      }

      return text(`❌ Error: Unknown action ${action}`, true);
    },
  );
}

function text(content: string, isError = false) {
  return { isError, content: [{ type: 'text' as const, text: content }] };
}

function pendingSendBody(
  body: Record<string, unknown>,
  responseData: Record<string, unknown>,
): Record<string, unknown> {
  if (body['channel_id'] || body['channel_name']) {
    return body;
  }

  const resolvedChannelId = responseData['channel_id'];
  if (typeof resolvedChannelId === 'string' && resolvedChannelId.trim()) {
    return { ...body, channel_id: resolvedChannelId };
  }

  return body;
}
