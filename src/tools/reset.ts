/**
 * discord_reset tool — Clear the conversation buffer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../shared/types.js';
import { daemonRequest, isDaemonOnline } from './client.js';

export function registerResetTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_reset',
    'Clear the Discord conversation memory buffer to start fresh. This removes all prior context from future responses.',
    {},
    async () => {
      if (!(await isDaemonOnline(config))) {
        return text('❌ Daemon is offline. Start it: node dist/setup.cjs');
      }

      const res = await daemonRequest({
        method: 'POST',
        path: '/reset',
        config,
        body: {},
      });

      if (!res.ok) {
        return text(`❌ Reset failed: ${res.data['error'] ?? 'unknown error'}`);
      }

      return text('✅ Conversation cleared. Next message will start fresh with no prior context.');
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
