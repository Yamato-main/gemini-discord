/**
 * MCP Server entry point (Track 2).
 * Spawned by Gemini CLI as a subprocess.
 * Registers Discord bridge tools that communicate with the daemon via localhost HTTP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, resolveExtensionDir } from './shared/config.js';
import { registerAdminTool } from './tools/admin.js';
import { registerMessageTool } from './tools/message.js';

import { registerHistoryTool } from './tools/history.js';
import { registerFindMediaTool } from './tools/find-media.js';
import { registerCronTools } from './tools/cron.js';
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
registerAdminTool(server, config);
registerMessageTool(server, config);

registerHistoryTool(server, config);
registerFindMediaTool(server, config);
registerCronTools(server, config);

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
