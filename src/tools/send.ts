/**
 * discord_send tool — Send a message to a Discord channel.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../shared/types.js';
import { daemonRequest, isDaemonOnline } from './client.js';

export function registerSendTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_send',
    'Send a message to a Discord channel. Defaults to the primary channel if channel_id is not specified.',
    {
      content: z.string().describe('The message content to send (max 6000 chars, auto-chunked)'),
      channel_id: z
        .string()
        .optional()
        .describe('Target channel ID. Defaults to the primary channel.'),
    },
    async ({ content, channel_id }) => {
      const targetChannel = channel_id ?? config.discordChannelId;

      if (!(await isDaemonOnline(config))) {
        return text('❌ Daemon is offline. Start it: node dist/setup.cjs');
      }

      const res = await daemonRequest({
        method: 'POST',
        path: '/send',
        config,
        body: { channel_id: targetChannel, content },
      });

      if (!res.ok) {
        return text(`❌ Send failed: ${res.data['error'] ?? 'unknown error'}`);
      }

      const chunks = (res.data['chunks'] as number) ?? 1;
      return text(`✅ Sent (${chunks} chunk${chunks > 1 ? 's' : ''}) to channel ${targetChannel}`);
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
