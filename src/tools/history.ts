/**
 * discord_history tool — Read recent Discord exchanges and conversation buffer.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config, DaemonHistory, ExchangeLog, ConversationArchive, ConversationMessage } from '../shared/types.js';
import { daemonRequest } from './client.js';

export function registerHistoryTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_history',
    'Read recent Discord message exchanges and the conversation memory buffer. Use this to see what has been discussed.',
    {
      limit: z
        .number()
        .min(1)
        .max(30)
        .default(10)
        .optional()
        .describe('Number of recent exchanges to return (1-30, default 10)'),
      channel_id: z
        .string()
        .optional()
        .describe('Channel ID to get history for. Omit for primary channel. DM channel IDs work here too.'),
      scope: z
        .enum(['current', 'archived', 'all'])
        .default('current')
        .optional()
        .describe('Whether to read only the active conversation, only archived sessions, or both.'),
    },
    async ({ limit, channel_id, scope = 'current' }) => {
      const queryLimit = limit ?? 10;
      const params = new URLSearchParams();
      if (channel_id) {
        params.set('channel_id', channel_id);
      }
      params.set('scope', scope);
      const queryPath = params.size > 0 ? `/history?${params.toString()}` : '/history';

      const res = await daemonRequest({ method: 'GET', path: queryPath, config });

      if (res.data['error'] === 'daemon_offline') {
        return text('❌ Daemon is offline. No history available. Reopen Gemini CLI or run `gemini extensions config gemini-discord` if setup is incomplete.');
      }

      if (!res.ok) {
        return text(`❌ History error: ${res.data['error'] ?? 'unknown error'}`);
      }

      const history = res.data as unknown as DaemonHistory;
      const messages = (history.messages ?? []).slice(-queryLimit);
      const conversation = history.conversation ?? [];
      const archives = history.archives ?? [];
      const participants = history.participants ?? [];
      const channels = history.channels ?? [];

      const lines: string[] = [];
      lines.push(`## Session`);
      lines.push(`- Key: \`${history.sessionKey}\``);

      if (participants.length > 0) {
        lines.push(`- Participants: ${participants.map((p) => `${p.name} (${p.kind})`).join(', ')}`);
      }

      if (channels.length > 0) {
        lines.push(`- Channels: ${channels.map((c) => `${c.name} [${c.id}]`).join(', ')}`);
      }

      lines.push('');

      // Exchange log
      if (messages.length > 0) {
        lines.push(`## Recent Exchanges (${messages.length})`);
        for (const msg of messages) {
          const m = msg as ExchangeLog;
          const replyIds = m.responseMessageIds.length > 0 ? m.responseMessageIds.join(', ') : 'none';
          lines.push(`- **${m.author}** (${m.authorType}) in \`${m.channelName}\` at ${m.at} [${m.elapsedMs}ms]`);
          lines.push(`  request: \`${m.requestMessageId}\` | replies: \`${replyIds}\` | trigger: \`${m.trigger}\` | images: ${m.attachmentCount}`);
          lines.push(`  > ${truncate(m.prompt, 150)}`);
          lines.push(`  → ${truncate(m.response, 150)}`);
        }
      } else {
        lines.push('No recent exchanges.');
      }

      // Conversation buffer
      if (conversation.length > 0) {
        lines.push('');
        lines.push(`## Conversation Buffer (${conversation.length} messages)`);
        for (const entry of conversation) {
          const c = entry as ConversationMessage;
          const label = c.role === 'user'
            ? `👤 ${c.authorName ?? 'User'} (${c.speakerKind ?? 'human'})`
            : `🤖 ${c.authorName ?? 'Assistant'}`;
          const location = c.channelName ? ` in ${c.channelName}` : '';
          const attachments = c.attachments && c.attachments.length > 0
            ? ` [images: ${c.attachments.map((attachment) => attachment.name).join(', ')}]`
            : '';
          lines.push(`${label}${location}: ${truncate(c.content || '(no text provided)', 200)}${attachments}`);
        }
      }

      if (archives.length > 0) {
        lines.push('');
        lines.push(`## Archived Sessions (${archives.length})`);
        for (const archive of archives) {
          renderArchive(lines, archive);
        }
      }

      return text(lines.join('\n'));
    },
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function renderArchive(lines: string[], archive: ConversationArchive): void {
  const header = archive.lastSessionId
    ? `- Archived at ${archive.archivedAt} | Gemini session ${archive.lastSessionId}`
    : `- Archived at ${archive.archivedAt}`;
  lines.push(header);
  for (const entry of archive.messages.slice(-8)) {
    const label = entry.role === 'user'
      ? `  👤 ${entry.authorName ?? 'User'}`
      : `  🤖 ${entry.authorName ?? 'Assistant'}`;
    lines.push(`${label}: ${truncate(entry.content || '(no text provided)', 160)}`);
  }
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
