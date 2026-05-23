/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Central router for health, status/discovery, message, session, cron, moderation, and admin routes.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import type {
  Config,
} from '../shared/types.js';
import { log } from './log.js';
import { resetConversationSession } from './session-reset.js';
import { resolveDmUserIdForChannel } from './dm-pairing.js';
import {
  respond,
  requireAuth,
  readBody,
  authorizeApiAction,
  resolveConversationSessionKey,
  type ApiDependencies,
} from './api-utils.js';
import { handleStatusRoutes } from './api/status.js';
import { handleDiscoveryRoutes } from './api/discovery.js';
import { handleMessageRoutes } from './api/messages.js';
import { handleCronRoutes } from './api/cron.js';
import { handleModerationRoutes } from './api/moderation.js';
import { ensureRuntimePaths } from '../shared/runtime-paths.js';

export {
  respond,
  requireAuth,
  readBody,
  authorizeApiAction,
  resolveConversationSessionKey,
  resolveSendChannelId,
  fetchTextChannel,
  isWritableTarget,
  type DaemonState,
  type ApiDependencies,
} from './api-utils.js';

export function startControlApi(deps: ApiDependencies): http.Server {
  const { config, memory, extensionDir, isShuttingDown, shutdown } = deps;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && isShuttingDown() && req.url !== '/shutdown') {
        respond(res, 503, { error: 'shutting down' });
        return;
      }

      const address = server.address();
      const currentPort = typeof address === 'string' ? config.daemonPort : (address?.port ?? config.daemonPort);
      const url = new URL(req.url ?? '/', `http://localhost:${currentPort}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        respond(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/shutdown') {
        if (!requireAuth(req, config)) {
          respond(res, 401, { error: 'Unauthorized' });
          return;
        }
        if (!authorizeApiAction(req, res, config, 'admin_command')) return;
        respond(res, 200, { ok: true, message: 'Shutdown initiated' });
        // Give the response a moment to send before killing the process
        setTimeout(() => shutdown('API'), 500);
        return;
      }

      if (handleStatusRoutes(req, res, url, deps)) return;
      if (await handleDiscoveryRoutes(req, res, url, deps)) return;
      if (await handleCronRoutes(req, res, pathname, null, deps)) return;

      if (req.method === 'POST') {
        if (!requireAuth(req, config)) {
          respond(res, 401, { error: 'Unauthorized' });
          return;
        }

        let body: string;
        try {
          body = await readBody(req);
        } catch {
          respond(res, 413, { error: 'Payload too large (max 10KB)' });
          return;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(body);
        } catch {
          respond(res, 400, { error: 'Invalid JSON' });
          return;
        }

        if (await handleMessageRoutes(req, res, pathname, parsed, deps)) return;
        if (await handleCronRoutes(req, res, pathname, parsed, deps)) return;

        if (pathname === '/reset') {
          if (!authorizeApiAction(req, res, config, 'session_reset')) return;
          const channelId = String(parsed['channel_id'] ?? '');
          if (!channelId) {
            respond(res, 400, { error: 'channel_id is required for reset' });
            return;
          }
          const guildId = parsed['guild_id'] == null ? null : String(parsed['guild_id']);
          const authorId = guildId ? null : resolveDmUserIdForChannel(extensionDir, channelId);
          resetConversationSession(config, memory, extensionDir, { channelId, guildId, authorId });
          respond(res, 200, { ok: true });
          return;
        }

        if (await handleModerationRoutes(req, res, pathname, parsed, deps)) return;
      }

      respond(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error('Control API error', { error: err instanceof Error ? err.message : String(err) });
      respond(res, 500, { error: 'Internal server error' });
    }
  });

  const tryListen = (port: number, retryCount = 0): void => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'string' ? port : (addr?.port ?? port);
      
      log.info('Control API listening', { port: actualPort, host: '127.0.0.1' });
      
      config.daemonPort = actualPort;

      try {
        const portPath = ensureRuntimePaths(extensionDir).daemonPortFile;
        fs.writeFileSync(portPath, String(actualPort), 'utf-8');
      } catch (e) {
        log.warn('Failed to write daemon port discovery file', { error: String(e) });
      }
    });

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        if (retryCount < 10) {
          log.info(`Port ${port} in use, trying next...`);
          tryListen(port + 1, retryCount + 1);
        } else {
          log.info('Many ports in use, falling back to system-assigned random port');
          tryListen(0);
        }
      } else {
        log.error('Control API listen error', { error: err.message });
      }
    });
  };

  tryListen(config.daemonPort);

  return server;
}
