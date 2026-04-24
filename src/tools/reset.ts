/**
 * discord_reset tool — Clear the conversation buffer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../shared/types.js';
import { daemonRequest, isDaemonOnline } from './client.js';

export function registerResetTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_reset',
    'Start a fresh Discord conversation by clearing both the saved Discord memory buffer and the bound Gemini CLI session for the current channel.',
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

      return text('✅ Started a fresh conversation. The saved Discord memory and Gemini CLI session were cleared for the current channel.');
    },
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
