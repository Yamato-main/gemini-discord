/**
 * MCP Server entry point (Track 2).
 * Spawned by Gemini CLI as a subprocess.
 * Registers 5 tools that communicate with the daemon via localhost HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, resolveExtensionDir } from './shared/config.js';
import { registerStatusTool } from './tools/status.js';
import { registerSendTool } from './tools/send.js';
import { registerReplyTool } from './tools/reply.js';
import { registerHistoryTool } from './tools/history.js';
import { registerResetTool } from './tools/reset.js';
import { registerRestartTool } from './tools/restart.js';
import { registerFindImagesTool } from './tools/find-images.js';
import { registerCronTools } from './tools/cron.js';
import { registerChannelsTool } from './tools/channels.js';
import { ensureDaemonRunning } from './shared/daemon-runtime.js';

// Resolve extension directory
let tmpDir = process.cwd();
try { tmpDir = __dirname; } catch {}
const extensionDir = resolveExtensionDir(tmpDir);
const config = loadConfig(extensionDir);

const server = new McpServer({
  name: 'discord-bridge',
  version: '0.1.0',
});

// Register all tools
registerStatusTool(server, config);
registerSendTool(server, config);
registerReplyTool(server, config);
registerHistoryTool(server, config);
registerResetTool(server, config);
registerRestartTool(server, config);
registerFindImagesTool(server);
registerCronTools(server, config);
registerChannelsTool(server, config);

// Connect via stdio (Gemini CLI manages the process lifecycle)
async function main() {
  if (config.autoStartDaemon) {
    try {
      await ensureDaemonRunning(config, extensionDir);
    } catch {
      // Tool calls will still surface a precise offline error if startup keeps failing.
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`gemini-discord MCP server error: ${err}\n`);
  process.exit(1);
});
