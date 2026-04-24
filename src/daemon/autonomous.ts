import type { Client, DMChannel, NewsChannel, TextChannel } from 'discord.js';
import { chunkMessage } from '../shared/chunker.js';
import type { Config, AutonomousSourceStatus, AutonomousStatusSnapshot } from '../shared/types.js';
import { log } from './log.js';
import { runtimeStore } from './runtime.js';
import { ensureGeminiBindingWorkspace, loadGeminiBindingState, saveGeminiBindingState } from './binding.js';
import { collectFourChanAwaySignal, getFourChanAutonomousBindingKey } from './autonomous-4chan.js';
import { sanitizeFullResponse } from './sanitizer.js';
import { sendDiscordMessage, type SendableChannel } from './sender.js';
import { resolveDiscoveredChannel } from './channels.js';

let intervalHandle: NodeJS.Timeout | null = null;
let kickoffHandle: NodeJS.Timeout | null = null;
let runPromise: Promise<void> | null = null;

const sourceStatuses = new Map<string, AutonomousSourceStatus>();
const LIVE_CHAT_PRIORITY_WINDOW_MS = 90_000;

const autonomousStatus: AutonomousStatusSnapshot = {
  enabled: false,
  running: false,
  intervalMs: 0,
  targetChannelId: '',
  targetChannelName: '',
  sources: [],
};

export function initAutonomous(config: Config, extensionDir: string): void {
  shutdownAutonomous();

  autonomousStatus.enabled = config.autonomous.enabled;
  autonomousStatus.intervalMs = config.autonomous.intervalMs;
  autonomousStatus.targetChannelId = config.autonomous.targetChannelId;
  autonomousStatus.targetChannelName = config.autonomous.targetChannelName;
  sourceStatuses.clear();
  syncStatusSnapshot();

  if (!config.autonomous.enabled) {
    log.info('Autonomous turns disabled');
    return;
  }

  kickoffHandle = setTimeout(() => {
    void runAutonomousCycle(config, extensionDir);
  }, 15_000);

  intervalHandle = setInterval(() => {
    void runAutonomousCycle(config, extensionDir);
  }, Math.max(30_000, config.autonomous.intervalMs));

  log.info('Autonomous turns initialized', {
    intervalMs: Math.max(30_000, config.autonomous.intervalMs),
    targetChannelId: config.autonomous.targetChannelId,
    targetChannelName: config.autonomous.targetChannelName,
    fourChanEnabled: config.autonomous.fourChan.enabled,
  });
}

export function shutdownAutonomous(): void {
  if (kickoffHandle) {
    clearTimeout(kickoffHandle);
    kickoffHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  autonomousStatus.running = false;
  syncStatusSnapshot();
}

export function getAutonomousStatus(): AutonomousStatusSnapshot {
  return {
    enabled: autonomousStatus.enabled,
    running: autonomousStatus.running,
    intervalMs: autonomousStatus.intervalMs,
    targetChannelId: autonomousStatus.targetChannelId,
    targetChannelName: autonomousStatus.targetChannelName,
    sources: autonomousStatus.sources.map((source) => ({ ...source })),
  };
}

async function runAutonomousCycle(config: Config, extensionDir: string): Promise<void> {
  if (runPromise) {
    return runPromise;
  }

  runPromise = (async () => {
    autonomousStatus.running = true;
    syncStatusSnapshot();

    try {
      const bindingWorkspace = ensureGeminiBindingWorkspace(
        extensionDir,
        getFourChanAutonomousBindingKey(),
      );
      const result = await collectFourChanAwaySignal({
        config,
        extensionDir,
        bindingDir: bindingWorkspace.bindingDir,
      });

      updateSourceStatus(result.sourceId, {
        lastPollAt: new Date().toISOString(),
        lastSignalScore: result.signalScore,
        lastDecision: result.decision,
        lastError: null,
      });

      if (!result.wakeRequest) {
        return;
      }

      const client = runtimeStore.client;
      const cliPool = runtimeStore.cliPool;
      const geminiSemaphore = runtimeStore.geminiSemaphore;

      if (!client || !cliPool || !geminiSemaphore) {
        updateSourceStatus(result.sourceId, {
          lastDecision: 'runtime_unavailable',
          lastError: 'autonomous runtime not ready',
        });
        log.warn('Autonomous turn skipped: runtime not ready', { sourceId: result.sourceId });
        return;
      }

      const lastInteractiveAt = runtimeStore.lastInteractiveMessageAt;
      if (
        geminiSemaphore.inFlight > 0 ||
        geminiSemaphore.waiting > 0 ||
        (lastInteractiveAt !== null && Date.now() - lastInteractiveAt < LIVE_CHAT_PRIORITY_WINDOW_MS)
      ) {
        updateSourceStatus(result.sourceId, {
          lastDecision: 'deferred_for_live_chat',
        });
        log.info('Autonomous turn deferred to preserve live Discord responsiveness', {
          sourceId: result.sourceId,
          inFlight: geminiSemaphore.inFlight,
          waiting: geminiSemaphore.waiting,
          lastInteractiveAt,
        });
        return;
      }

      const channel = await resolveAutonomousTargetChannel(config, client);
      if (!channel) {
        updateSourceStatus(result.sourceId, {
          lastDecision: 'channel_unavailable',
          lastError: 'target channel unavailable',
        });
        log.warn('Autonomous turn skipped: target channel unavailable', { sourceId: result.sourceId });
        return;
      }

      await geminiSemaphore.acquireWithTimeout(10_000, () => {
        log.info('Autonomous turn waiting for Gemini slot', { sourceId: result.sourceId });
      });

      const bindingState = loadGeminiBindingState(bindingWorkspace.bindingDir);
      let currentSessionId: string | null = null;
      let posted = false;

      try {
        const rawResponse = await cliPool.send(
          result.wakeRequest.bindingKey,
          result.wakeRequest.prompt,
          {
            onToken: () => {},
            onThought: () => {},
          },
          {
            cwd: bindingWorkspace.bindingDir,
            resumeSessionId: bindingState.lastSessionId ?? (bindingState.hasSession ? 'latest' : null),
            isBoss: false,
            toolMode: 'web',
            attachmentPaths: result.wakeRequest.attachmentPaths,
            onSessionId: (sessionId) => {
              currentSessionId = sessionId;
            },
          },
        );

        saveGeminiBindingState(bindingWorkspace.bindingDir, {
          hasSession: true,
          lastSessionId: currentSessionId ?? bindingState.lastSessionId,
        });

        const response = sanitizeFullResponse(rawResponse).trim();
        const normalized = response.toUpperCase().replace(/[.\s]+$/g, '');

        updateSourceStatus(result.sourceId, {
          lastEvaluatedAt: new Date().toISOString(),
        });

        if (!response || normalized === 'NOTHING_TO_REPORT') {
          await result.wakeRequest.markEvaluated(false);
          updateSourceStatus(result.sourceId, {
            lastDecision: 'nothing_to_report',
          });
          log.info('Autonomous turn produced no reportable message', {
            sourceId: result.sourceId,
            summary: result.wakeRequest.summary,
          });
          return;
        }

        const finalMessage = ensureHeyYamatoPrefix(response);
        await sendDiscordMessage(channel, finalMessage, chunkMessage);
        await result.wakeRequest.markEvaluated(true);
        posted = true;

        updateSourceStatus(result.sourceId, {
          lastDecision: 'posted',
          lastPostedAt: new Date().toISOString(),
          lastEvaluatedAt: new Date().toISOString(),
        });

        log.info('Autonomous message posted', {
          sourceId: result.sourceId,
          signalScore: result.wakeRequest.signalScore,
          channelId: channel.id,
        });
      } catch (error) {
        updateSourceStatus(result.sourceId, {
          lastDecision: 'error',
          lastError: error instanceof Error ? error.message : String(error),
          lastEvaluatedAt: new Date().toISOString(),
        });
        log.error('Autonomous turn failed', {
          sourceId: result.sourceId,
          posted,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        geminiSemaphore.release();
      }
    } catch (error) {
      updateSourceStatus('4chan-a', {
        lastPollAt: new Date().toISOString(),
        lastDecision: 'poll_error',
        lastError: error instanceof Error ? error.message : String(error),
      });
      log.error('Autonomous poll cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      autonomousStatus.running = false;
      syncStatusSnapshot();
      runPromise = null;
    }
  })();

  return runPromise;
}

async function resolveAutonomousTargetChannel(
  config: Config,
  client: Client,
): Promise<SendableChannel | null> {
  const configuredId = config.autonomous.targetChannelId || config.reportingChannelId || config.discordChannelId;
  const configuredName = config.autonomous.targetChannelName.trim();

  if (configuredName) {
    const resolved = await resolveDiscoveredChannel(configuredName, client);
    if (resolved) {
      return fetchSendableChannel(client, resolved.id);
    }
  }

  return fetchSendableChannel(client, configuredId);
}

async function fetchSendableChannel(
  client: Client,
  channelId: string,
): Promise<SendableChannel | null> {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  if ('send' in channel && typeof channel.send === 'function') {
    return channel as TextChannel | DMChannel | NewsChannel;
  }

  return null;
}

function ensureHeyYamatoPrefix(response: string): string {
  const trimmed = response.trim();
  if (/^hey,\s*yamato[,!]/i.test(trimmed)) {
    return trimmed;
  }
  return `Hey, Yamato, ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function updateSourceStatus(
  sourceId: string,
  patch: Partial<AutonomousSourceStatus>,
): void {
  const current = sourceStatuses.get(sourceId) ?? {
    id: sourceId,
    lastPollAt: null,
    lastEvaluatedAt: null,
    lastPostedAt: null,
    lastSignalScore: 0,
    lastDecision: null,
    lastError: null,
  };

  sourceStatuses.set(sourceId, {
    ...current,
    ...patch,
  });
  syncStatusSnapshot();
}

function syncStatusSnapshot(): void {
  autonomousStatus.sources = [...sourceStatuses.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) => ({ ...source }));
}
