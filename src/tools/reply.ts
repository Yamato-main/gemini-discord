/**
 * discord_reply tool — Reply to a specific message by ID.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../shared/types.js';
import { daemonRequest, isDaemonOnline } from './client.js';

export function registerReplyTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_reply',
    'Reply to a specific Discord message by ID, creating a threaded reply. Get message IDs from discord_history.',
    {
      channel_id: z.string().describe('The channel ID containing the message'),
      message_id: z.string().describe('The message ID to reply to (get from discord_history)'),
      content: z.string().optional().describe('Optional text to accompany attached files. DO NOT use this for your normal conversational response, as your standard text output is automatically streamed to Discord.'),
      files: z.array(z.string()).optional().describe('Optional array of absolute file paths to attach'),
    },
    async ({ channel_id, message_id, content = '', files }) => {
      if (!(await isDaemonOnline(config))) {
        return text('❌ Daemon is offline. Start it: node dist/setup.cjs');
      }

      const res = await daemonRequest({
        method: 'POST',
        path: '/reply',
        config,
        body: { channel_id, message_id, content, files },
      });

      if (!res.ok) {
        return text(`❌ Reply failed: ${res.data['error'] ?? 'unknown error'}`);
      }

      return text('✅ Reply sent with the attached content/files.');
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
