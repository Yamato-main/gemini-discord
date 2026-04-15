import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { restartDaemon } from '../shared/daemon-runtime.js';
import { resolveExtensionDir } from '../shared/config.js';
import type { Config } from '../shared/types.js';

/**
 * Register the discord_restart tool.
 * Shuts down the current daemon (if running) and starts it fresh.
 */
export function registerRestartTool(server: McpServer, config: Config) {
  server.tool(
    'discord_restart',
    'Restart the Discord bridge daemon. Use this after changing configuration or if the daemon is unresponsive.',
    {},
    async () => {
      try {
        const extensionDir = resolveExtensionDir(__dirname);
        await restartDaemon(config, extensionDir);
        return {
          content: [{ type: 'text', text: '✅ Discord daemon restarted successfully.' }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `❌ Failed to restart Discord daemon: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );
}
