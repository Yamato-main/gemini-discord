import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config, DaemonStatus } from '../shared/types.js';
import { daemonRequest } from './client.js';

export function registerChannelsTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_channels',
    {
      query: z.string().optional().describe('Optional channel name or partial string to filter discovered channels.'),
    },
    async ({ query }) => {
      const res = await daemonRequest({ method: 'GET', path: '/status', config });

      if (res.data['error'] === 'daemon_offline') {
        return text('❌ Daemon is offline. Reopen Gemini CLI or run `gemini extensions config gemini-discord` if setup is incomplete.');
      }

      if (!res.ok) {
        return text(`❌ Failed to fetch channels: ${JSON.stringify(res.data)}`);
      }

      const status = res.data as unknown as DaemonStatus;
      const channels = status.channels ?? [];
      const needle = query?.trim().toLowerCase();
      const filtered = needle
        ? channels.filter((channel) => channel.name.toLowerCase().includes(needle) || channel.id.includes(needle))
        : channels;

      if (filtered.length === 0) {
        return text(needle ? `No discovered channels matched "${query}".` : 'No channels have been discovered yet.');
      }

      const lines = filtered.map((channel) => `- #${channel.name} → ${channel.id}`);
      return text(lines.join('\n'));
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
