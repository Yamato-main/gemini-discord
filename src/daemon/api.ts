/**
 * HTTP control API — localhost-only, Bearer auth on mutating routes.
 * Central router for health, status/discovery, message, session, cron, moderation, and admin routes.
 */

import * as http from 'node:http';
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

      const url = new URL(req.url ?? '/', `http://localhost:${config.daemonPort}`);
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

  server.listen(config.daemonPort, '127.0.0.1', () => {
    log.info('Control API listening', { port: config.daemonPort, host: '127.0.0.1' });
  });

  return server;
}
