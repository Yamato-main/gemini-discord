/**
 * Daemon entry point (Track 1).
 * Startup sequence: preflight → config → probe → HTTP API → gateway (Discord bot).
 */

import { loadConfig, resolveExtensionDir } from './shared/config.js';
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

let tmpDir = process.cwd();
try { tmpDir = __dirname; } catch {}
const extensionDir = resolveExtensionDir(tmpDir);

let shuttingDown = false;

const state: DaemonState = {
  status: 'starting',
  startedAt: new Date().toISOString(),
  geminiReachable: false,
  geminiVersion: 'unknown',
  messagesHandled: 0,
  lastMessageAt: null,
  lastError: null,
  exchangeLog: [],
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
  const removedLegacyContextFiles = cleanupLegacyBindingContextFiles(extensionDir);
  if (removedLegacyContextFiles > 0) {
    log.info('Removed legacy per-binding Gemini context files', { count: removedLegacyContextFiles });
  }

  log.info('Config loaded', {
    channelId: config.discordChannelId,
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

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    runtimeStore.isShuttingDown = true;
    log.info('Shutting down', { signal });

    cliPool.killAll();
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

  const apiServer = startControlApi({
    config,
    state,
    memory,
    queue,
    extensionDir,
    get client() { return runtimeStore.client; },
    isShuttingDown: () => shuttingDown,
    shutdown,
  });

  const probe = await probeDiscordGateway(config.discordBotToken);
  if (!probe.ok) {
    log.error('Discord Gateway probe failed', { error: probe.error });
    process.exit(1);
  }
  if (!probe.hasMessageContent) {
    log.warn('Message Content Intent appears to be missing or disabled. The bot may not receive message text.');
  }

  log.info('Discord Gateway probe succeeded', { botTag: probe.botTag });

  const { initGateway } = await import('./daemon/gateway.js');
  await initGateway(config, state, memory, queue, apiServer, extensionDir);

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
