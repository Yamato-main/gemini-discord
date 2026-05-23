/**
 * Daemon entry point (Track 1).
 * Startup sequence: preflight → config → probe → HTTP API → gateway (Discord bot).
 */

import * as http from 'node:http';
import { loadConfig, resolveExtensionDir, persistConfigEnvUpdates } from './shared/config.js';
import { sanitizeAllowedUserIds } from './shared/config-sanitize.js';
import { ENV } from './shared/config-vars.js';
import { runPreflight } from './daemon/preflight.js';
import { ConversationMemory } from './daemon/memory.js';
import { ChannelQueue } from './daemon/queue.js';
import { startControlApi, type DaemonState } from './daemon/api.js';
import { log } from './daemon/log.js';
import { Semaphore } from './daemon/semaphore.js';
import { sleep } from './daemon/retry.js';
import { CliProcessPool } from './daemon/cli-pool.js';
import { runtimeStore } from './daemon/runtime.js';
import { probeDiscordGateway } from './daemon/probe.js';
import { shutdownCron } from './daemon/cron.js';
import { cleanupLegacyBindingContextFiles } from './daemon/binding.js';
import { startTmpAttachmentCleanup } from './daemon/attachment-cleanup.js';
import { validateBossConfig } from './daemon/permissions.js';

let tmpDir = process.cwd();
try { tmpDir = __dirname; } catch {}
const extensionDir = resolveExtensionDir(tmpDir);

let shuttingDown = false;
let attachmentCleanupTimer: NodeJS.Timeout | null = null;

const state: DaemonState = {
  status: 'starting',
  startedAt: new Date().toISOString(),
  geminiReachable: false,
  geminiVersion: 'unknown',
  messagesHandled: 0,
  lastMessageAt: null,
  lastError: null,
  exchangeLog: [],
  bridgeAdminUserId: null,
  bridgeAdminTag: null,
};

async function main(): Promise<void> {
  log.info('gemini-discord daemon starting', { dir: extensionDir });

  const preflight = await runPreflight(extensionDir);
  state.geminiReachable = preflight.geminiReachable;
  state.geminiVersion = preflight.geminiVersion;

  if (!preflight.geminiReachable) {
    state.status = 'degraded';
  }

  const config = loadConfig(extensionDir);
  attachmentCleanupTimer = startTmpAttachmentCleanup(extensionDir);
  const removedLegacyContextFiles = cleanupLegacyBindingContextFiles(extensionDir);
  if (removedLegacyContextFiles > 0) {
    log.info('Removed legacy per-binding Gemini context files', { count: removedLegacyContextFiles });
  }

  log.info('Config loaded', {
    channelId: config.discordChannelId,
    bossConfigValid: validateBossConfig(config).valid,
    owners: config.ownerIds.length,
    allowlistedUsers: config.allowedUserIds.length,
    allowlistedAgents: config.allowedAgentIds.length,
    streaming: config.streaming,
    enableDMs: config.enableDMs,
    useGeminiCliSessions: config.useGeminiCliSessions,
    port: config.daemonPort,
    model: config.geminiModel,
    geminiMaxConcurrent: config.geminiMaxConcurrent,
  });

  const memory = new ConversationMemory(extensionDir, config.conversationHistoryLength);
  memory.startAutoFlush();
  log.info('Conversation memory initialized', { sessions: memory.sessions().length });

  const queue = new ChannelQueue(config.queueMaxDepth);
  const geminiSemaphore = new Semaphore(config.geminiMaxConcurrent);
  const cliPool = new CliProcessPool(config);
  
  runtimeStore.memory = memory;
  runtimeStore.queue = queue;
  runtimeStore.geminiSemaphore = geminiSemaphore;
  runtimeStore.cliPool = cliPool;

  let apiServer: http.Server | null = null;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    runtimeStore.isShuttingDown = true;
    log.info('Shutting down', { signal });

    cliPool.killAll();
    if (attachmentCleanupTimer) {
      clearInterval(attachmentCleanupTimer);
      attachmentCleanupTimer = null;
    }
    await Promise.race([queue.drainAll(), sleep(30_000)]);
    memory.stopAutoFlush();

    if (runtimeStore.client) {
      runtimeStore.client.destroy();
    }

    shutdownCron();
    
    if (apiServer) {
      apiServer.close(() => {
        log.info('Shutdown complete');
        process.exit(0);
      });
    } else {
      log.info('Shutdown complete (no API server)');
      process.exit(0);
    }

    setTimeout(() => {
      log.error('Forced exit — shutdown timed out');
      process.exit(1);
    }, 35_000);
  }

  const probe = await probeDiscordGateway(config.discordBotToken);
  if (!probe.ok) {
    log.error('Discord Gateway probe failed', { error: probe.error });
    process.exit(1);
  }
  if (!probe.hasMessageContent) {
    log.warn('Message Content Intent appears to be missing or disabled in the Discord Developer Portal. The bot will not be able to read message content!');
  }
  if (config.enableServerMembersIntent !== false && !probe.hasGuildMembers) {
    log.warn('Server Members Intent is not enabled in the Discord Developer Portal, but the bot is configured to request it.');
    log.warn('To prevent a fatal 4014 (Disallowed Intents) disconnect, we are automatically disabling the Guild Members intent for this connection.');
    log.warn('Note: User discovery and some role-based features will be limited. Enable the "Server Members Intent" in the Developer Portal to restore them.');
    config.enableServerMembersIntent = false;
  }

  log.info('Discord Gateway probe succeeded', { botTag: probe.botTag });

  state.bridgeAdminUserId = probe.botId;
  state.bridgeAdminTag = probe.botTag;

  const sanitizeResult = sanitizeAllowedUserIds(config, probe.botId);

  if (sanitizeResult.changed) {
    log.info('Sanitized non-human guest IDs from human guest allowlist on startup', {
      original: config.allowedUserIds,
      sanitized: sanitizeResult.allowedUserIds,
    });
    for (const warning of sanitizeResult.warnings) {
      log.warn('Sanitize warning:', { warning });
    }
    config.allowedUserIds = sanitizeResult.allowedUserIds;
    try {
      persistConfigEnvUpdates(extensionDir, {
        [ENV.DISCORD_ALLOWED_USER_IDS]: sanitizeResult.allowedUserIds.join(','),
      });
    } catch (e) {
      log.warn('Failed to persist sanitized allowlist config', { error: String(e) });
    }
  }

  apiServer = startControlApi({
    config,
    state,
    memory,
    queue,
    extensionDir,
    get client() { return runtimeStore.client; },
    isShuttingDown: () => shuttingDown,
    shutdown,
  });

  const { initGateway } = await import('./daemon/gateway.js');
  await initGateway(config, state, memory, queue, apiServer, extensionDir);

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
