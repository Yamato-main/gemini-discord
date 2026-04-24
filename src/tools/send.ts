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
      content: z.string().optional().describe('Optional text to accompany attached files. DO NOT use this for your normal conversational response, as your standard text output is automatically streamed to Discord.'),
      channel_id: z
        .string()
        .optional()
        .describe('Target channel ID. Defaults to the primary channel.'),
      channel_name: z
        .string()
        .optional()
        .describe('Target channel name such as "boardroom" or "#boardroom". Use this when you want the daemon to resolve a discovered channel by name.'),
      files: z.array(z.string()).optional().describe('Optional array of absolute file paths to attach'),
    },
    async ({ content = '', channel_id, channel_name, files }) => {
      const body: Record<string, unknown> = { content, files };
      if (channel_id) {
        body['channel_id'] = channel_id;
      } else if (channel_name) {
        body['channel_name'] = channel_name;
      } else {
        body['channel_id'] = config.discordChannelId;
      }

      if (!(await isDaemonOnline(config))) {
        return text('❌ Daemon is offline. Start it: node dist/setup.cjs');
      }

      const res = await daemonRequest({
        method: 'POST',
        path: '/send',
        config,
        body,
      });

      if (!res.ok) {
        return text(`❌ Send failed: ${res.data['error'] ?? 'unknown error'}`);
      }

      const chunks = (res.data['chunks'] as number) ?? 1;
      const resolvedChannel = String(res.data['channel_id'] ?? channel_id ?? channel_name ?? config.discordChannelId);
      return text(`✅ Sent (${chunks} chunk${chunks > 1 ? 's' : ''}) to channel ${resolvedChannel}.`);
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
