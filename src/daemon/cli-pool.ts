/**
 * Persistent Gemini CLI ACP pool.
 *
 * Each binding/tool tier gets a warm Gemini CLI ACP process that keeps a real
 * Gemini session alive between Discord turns. That removes the repeated CLI
 * cold-start cost while preserving the exact same prompt and @file packaging we
 * already use for headless one-shot calls.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import type { Config } from '../shared/types.js';
import type { ToolMode } from './tool-mode.js';
import { log } from './log.js';
import { buildGeminiCliPrompt } from './gemini-input.js';
import { extractGeminiResultText, getGeminiTextDelta } from './gemini-output.js';

const DISCORD_BRIDGE_TOOLS = [
  'discord_status',
  'discord_send',
  'discord_reply',
  'discord_history',
  'discord_reset',
  'discord_restart',
  'discord_find_images',
  'discord_channels',
  'schedule_cron_job',
  'list_cron_jobs',
  'delete_cron_job',
].join(',');

const ACP_PROTOCOL_VERSION = 1;
const SESSION_REQUEST_TIMEOUT_MS = 120_000;
const STARTUP_REQUEST_TIMEOUT_MS = 90_000;
const SESSION_REPLAY_QUIET_MS = 400;
const SESSION_REPLAY_MAX_WAIT_MS = 6_000;

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThought?: () => void;
}

export interface PoolSendOptions {
  cwd: string;
  resumeSessionId?: string | null;
  isBoss: boolean;
  toolMode: ToolMode;
  attachmentPaths?: string[];
  onSessionId?: (sessionId: string) => void;
}

interface PoolStatus {
  total: number;
  busy: number;
  idle: number;
  maxSize: number;
  processes: Array<{
    poolKey: string;
    busy: boolean;
    aliveMs: number;
    lastActivityMs: number;
    allowedTools: string;
  }>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ActivePrompt {
  requestId: number;
  callbacks: StreamCallbacks;
  fullResponse: string;
  sawAssistantOutput: boolean;
  lastOutputAt: number;
  startedAt: number;
  timeoutHandle: NodeJS.Timeout;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface PersistentProcess {
  proc: ChildProcess;
  poolKey: string;
  rl: readline.Interface;
  busy: boolean;
  spawnedAt: number;
  lastActivityAt: number;
  idleTimer: NodeJS.Timeout | null;
  allowedTools: string;
  initialized: boolean;
  nextRequestId: number;
  pendingRequests: Map<number, PendingRequest>;
  activePrompt: ActivePrompt | null;
  sessionId: string | null;
  cwd: string | null;
  stderrTail: string;
  lastSessionUpdateAt: number;
}

function resolveAllowedTools(isBoss: boolean, toolMode: ToolMode): string {
  switch (toolMode) {
    case 'chat':
      return 'none';
    case 'web':
      return 'google_web_search,web_fetch';
    case 'discord':
      return isBoss ? DISCORD_BRIDGE_TOOLS : 'none';
    case 'web_discord':
      return isBoss ? `google_web_search,web_fetch,${DISCORD_BRIDGE_TOOLS}` : 'google_web_search,web_fetch';
    case 'full':
      return isBoss ? 'all' : 'none';
    default:
      return 'none';
  }
}

function buildPoolKey(bindingKey: string, allowedTools: string): string {
  const tier = allowedTools === 'all'
    ? 'full'
    : allowedTools === 'none'
      ? 'chat'
      : allowedTools === 'google_web_search,web_fetch'
        ? 'web'
        : allowedTools.includes('google_web_search,web_fetch')
          ? 'web-discord'
          : 'discord';
  return `${bindingKey}:${tier}`;
}

function appendHeadlessIsolationArgs(args: string[]): void {
  args.push('--extensions', 'gemini-discord');
  args.push('--allowed-mcp-server-names', 'discord-bridge');
}

function normalizeResumeSessionId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== 'latest' ? trimmed : null;
}

function normalizeAcpError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const message = typeof candidate['message'] === 'string' ? candidate['message'] : 'Gemini ACP request failed';
    const details = candidate['data'];
    if (details && typeof details === 'object' && 'details' in (details as Record<string, unknown>)) {
      const detailMessage = (details as Record<string, unknown>)['details'];
      if (typeof detailMessage === 'string' && detailMessage.trim()) {
        return new Error(`${message}: ${detailMessage}`);
      }
    }
    return new Error(message);
  }
  return new Error(typeof error === 'string' ? error : 'Gemini ACP request failed');
}

function isRetryableAcpExitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('gemini acp exited with code 1')
    || message.includes('gemini returned no assistant output');
}

function isMissingSessionError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('no previous sessions found for this project')
    || message.includes('session not found')
    || message.includes('invalid session identifier')
    || message.includes('failed to resolve session')
    || message.includes('resume_session_unavailable');
}

function extractUpdateText(update: Record<string, unknown>): string {
  const content = update['content'];
  if (Array.isArray(content)) {
    return content
      .map((value) => {
        if (!value || typeof value !== 'object') {
          return '';
        }
        const record = value as Record<string, unknown>;
        const inner = record['content'];
        if (inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>)['text'] === 'string') {
          return String((inner as Record<string, unknown>)['text']);
        }
        return typeof record['text'] === 'string' ? record['text'] : '';
      })
      .join('');
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record['text'] === 'string') {
      return record['text'];
    }
  }

  return '';
}

function buildAcpPromptBlocks(prompt: string, attachmentPaths?: string[]): Array<{ type: 'text'; text: string }> {
  return [{
    type: 'text',
    text: buildGeminiCliPrompt(prompt, attachmentPaths),
  }];
}

export class CliProcessPool {
  private pool = new Map<string, PersistentProcess>();
  private maxSize: number;
  private idleTimeoutMs: number;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.maxSize = config.geminiMaxConcurrent;
    this.idleTimeoutMs = config.cliIdleTimeoutMs;
  }

  async send(
    bindingKey: string,
    prompt: string,
    callbacks: StreamCallbacks,
    opts: PoolSendOptions,
  ): Promise<string> {
    const allowedTools = resolveAllowedTools(opts.isBoss, opts.toolMode);
    const poolKey = buildPoolKey(bindingKey, allowedTools);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      let entry = this.pool.get(poolKey);

      if (entry && !entry.busy && this.isAlive(entry)) {
        entry.busy = true;
        entry.lastActivityAt = Date.now();
        this.resetIdleTimer(entry);
        log.info('CLI pool: reusing warm ACP process', {
          poolKey,
          aliveMs: Date.now() - entry.spawnedAt,
          sessionId: entry.sessionId,
        });
      } else {
        if (entry) {
          this.evict(poolKey);
        }

        if (this.pool.size >= this.maxSize) {
          this.evictOldestIdle();
        }

        entry = await this.spawnProcess(poolKey, allowedTools);
        entry.busy = true;
        this.pool.set(poolKey, entry);
      }

      try {
        await this.ensureSession(entry, opts);
        const response = await this.promptWithAcp(entry, prompt, callbacks, opts);
        entry.busy = false;
        entry.lastActivityAt = Date.now();
        this.resetIdleTimer(entry);
        return response;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        lastError = normalized;
        this.evict(poolKey);

        if (attempt === 0 && isRetryableAcpExitError(normalized)) {
          log.warn('CLI pool: retrying Gemini ACP after crash', {
            poolKey,
            error: normalized.message,
          });
          continue;
        }

        throw normalized;
      }
    }

    throw lastError ?? new Error('Gemini ACP request failed');
  }

  private async spawnProcess(poolKey: string, allowedTools: string): Promise<PersistentProcess> {
    const spawnedAt = Date.now();
    const args = [
      '--acp',
      '--model', this.config.geminiModel,
      '--approval-mode', 'yolo',
      '--allowed-tools', allowedTools,
    ];
    appendHeadlessIsolationArgs(args);

    log.info('CLI pool: initializing ACP process entry', {
      poolKey,
      model: this.config.geminiModel,
      allowedTools,
      extensionScope: 'gemini-discord',
    });

    const proc = spawn(this.config.geminiPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    if (!proc.stdout || !proc.stdin) {
      throw new Error('Gemini ACP did not expose the expected stdio streams.');
    }

    const rl = readline.createInterface({ input: proc.stdout });
    const entry: PersistentProcess = {
      proc,
      poolKey,
      rl,
      busy: false,
      spawnedAt,
      lastActivityAt: spawnedAt,
      idleTimer: null,
      allowedTools,
      initialized: false,
      nextRequestId: 1,
      pendingRequests: new Map(),
      activePrompt: null,
      sessionId: null,
      cwd: null,
      stderrTail: '',
      lastSessionUpdateAt: 0,
    };

    proc.stderr?.on('data', (chunk: Buffer) => {
      entry.stderrTail = `${entry.stderrTail}${chunk.toString()}`.slice(-4000);
    });

    rl.on('line', (line: string) => {
      this.handleStdoutLine(entry, line);
    });

    proc.on('error', (error) => {
      this.rejectAllPending(entry, new Error(`Failed to spawn gemini: ${error.message}`));
      this.pool.delete(entry.poolKey);
    });

    proc.on('close', (code) => {
      this.rejectAllPending(entry, new Error(`Gemini ACP exited with code ${code}. ${entry.stderrTail.slice(-300)}`));
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
      try {
        rl.close();
      } catch {}
      this.pool.delete(entry.poolKey);
    });

    try {
      await this.sendRequest(entry, 'initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: 'gemini-discord',
          version: '0.1.0',
        },
      }, STARTUP_REQUEST_TIMEOUT_MS);
      entry.initialized = true;
      this.resetIdleTimer(entry);
      return entry;
    } catch (error) {
      try {
        proc.kill('SIGTERM');
      } catch {}
      try {
        rl.close();
      } catch {}
      throw error;
    }
  }

  private async ensureSession(entry: PersistentProcess, opts: PoolSendOptions): Promise<void> {
    const resumeSessionId = normalizeResumeSessionId(opts.resumeSessionId);

    if (entry.sessionId && entry.cwd === opts.cwd) {
      if (!resumeSessionId || resumeSessionId === entry.sessionId) {
        opts.onSessionId?.(entry.sessionId);
        return;
      }

      await this.closeSession(entry);
    }

    if (resumeSessionId) {
      try {
        await this.sendRequest(entry, 'session/load', {
          sessionId: resumeSessionId,
          cwd: opts.cwd,
          mcpServers: [],
        }, SESSION_REQUEST_TIMEOUT_MS);
        entry.sessionId = resumeSessionId;
        entry.cwd = opts.cwd;
        await this.waitForSessionReplayToDrain(entry);
        opts.onSessionId?.(entry.sessionId);
        return;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (!isMissingSessionError(normalized)) {
          throw normalized;
        }

        log.warn('CLI pool: resume target unavailable, starting fresh session', {
          poolKey: entry.poolKey,
          requestedSessionId: resumeSessionId,
          cwd: opts.cwd,
          error: normalized.message,
        });
        entry.sessionId = null;
        entry.cwd = null;
      }
    }

    const result = await this.sendRequest(entry, 'session/new', {
      cwd: opts.cwd,
      mcpServers: [],
    }, SESSION_REQUEST_TIMEOUT_MS);

    if (!result || typeof result !== 'object' || typeof (result as Record<string, unknown>)['sessionId'] !== 'string') {
      throw new Error('Gemini ACP did not return a sessionId for the new session.');
    }

    entry.sessionId = String((result as Record<string, unknown>)['sessionId']);
    entry.cwd = opts.cwd;
    opts.onSessionId?.(entry.sessionId);
  }

  private async closeSession(entry: PersistentProcess): Promise<void> {
    if (!entry.sessionId) {
      return;
    }

    try {
      await this.sendRequest(entry, 'session/close', {
        sessionId: entry.sessionId,
      }, 30_000);
    } catch {
      // Best-effort cleanup only.
    } finally {
      entry.sessionId = null;
      entry.cwd = null;
    }
  }

  private async waitForSessionReplayToDrain(entry: PersistentProcess): Promise<void> {
    const startedAt = Date.now();
    let lastObservedAt = startedAt;

    while (Date.now() - startedAt < SESSION_REPLAY_MAX_WAIT_MS) {
      if (entry.lastSessionUpdateAt > lastObservedAt) {
        lastObservedAt = entry.lastSessionUpdateAt;
      }

      if (Date.now() - lastObservedAt >= SESSION_REPLAY_QUIET_MS) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    log.warn('CLI pool: session replay did not fully drain before prompt', {
      poolKey: entry.poolKey,
      sessionId: entry.sessionId,
      waitedMs: Date.now() - startedAt,
    });
  }

  private async promptWithAcp(
    entry: PersistentProcess,
    prompt: string,
    callbacks: StreamCallbacks,
    opts: PoolSendOptions,
  ): Promise<string> {
    if (!entry.sessionId) {
      throw new Error('Gemini ACP session is not initialized.');
    }

    const requestId = entry.nextRequestId++;
    const hasAttachments = (opts.attachmentPaths?.length ?? 0) > 0;

    return new Promise<string>((resolve, reject) => {
      const maxTotalTimeoutMs = this.config.geminiTimeoutMs;
      const firstOutputTimeoutMs = hasAttachments
        ? Math.min(maxTotalTimeoutMs, 240_000)
        : 120_000;
      const postOutputTimeoutMs = 120_000;

      const activePrompt: ActivePrompt = {
        requestId,
        callbacks,
        fullResponse: '',
        sawAssistantOutput: false,
        lastOutputAt: Date.now(),
        startedAt: Date.now(),
        timeoutHandle: setInterval(() => {
          const current = entry.activePrompt;
          if (!current || current.requestId !== requestId) {
            return;
          }

          const idleMs = Date.now() - current.lastOutputAt;
          const totalMs = Date.now() - current.startedAt;
          if (!current.sawAssistantOutput && idleMs > firstOutputTimeoutMs) {
            const error = new Error(`Gemini stalled — no output for ${Math.round(idleMs / 1000)}s`);
            this.failPrompt(entry, error, true);
            return;
          }
          if (current.sawAssistantOutput && idleMs > postOutputTimeoutMs) {
            const error = new Error(`Gemini stalled — no output for ${Math.round(idleMs / 1000)}s`);
            this.failPrompt(entry, error, true);
            return;
          }
          if (totalMs > maxTotalTimeoutMs) {
            const error = new Error(`Gemini timed out after ${Math.round(totalMs / 1000)}s total`);
            this.failPrompt(entry, error, true);
          }
        }, 5000),
        resolve,
        reject,
      };

      entry.activePrompt = activePrompt;
      entry.pendingRequests.set(requestId, {
        resolve: () => {
          const current = entry.activePrompt;
          if (!current || current.requestId !== requestId) {
            resolve('');
            return;
          }
          clearInterval(current.timeoutHandle);
          entry.activePrompt = null;
          if (!current.sawAssistantOutput) {
            reject(new Error('Gemini returned no assistant output for this turn.'));
            return;
          }
          resolve(current.fullResponse);
        },
        reject: (error) => {
          const current = entry.activePrompt;
          if (current && current.requestId === requestId) {
            clearInterval(current.timeoutHandle);
            entry.activePrompt = null;
          }
          reject(error);
        },
      });

      try {
        this.writeJsonLine(entry, {
          jsonrpc: '2.0',
          id: requestId,
          method: 'session/prompt',
          params: {
            sessionId: entry.sessionId,
            prompt: buildAcpPromptBlocks(prompt, opts.attachmentPaths),
          },
        });
      } catch (error) {
        this.failPrompt(entry, error instanceof Error ? error : new Error(String(error)), false);
      }
    });
  }

  private handleStdoutLine(entry: PersistentProcess, line: string): void {
    if (line.length < 3 || line[0] !== '{') {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const method = typeof parsed['method'] === 'string' ? parsed['method'] : null;
    if (method === 'session/update') {
      const params = parsed['params'];
      if (params && typeof params === 'object') {
        this.handleSessionUpdate(entry, params as Record<string, unknown>);
      }
      return;
    }

    const rawId = parsed['id'];
    if (typeof rawId !== 'number') {
      return;
    }

    const pending = entry.pendingRequests.get(rawId);
    if (!pending) {
      return;
    }

    entry.pendingRequests.delete(rawId);
    if ('error' in parsed && parsed['error']) {
      pending.reject(normalizeAcpError(parsed['error']));
      return;
    }

    const activePrompt = entry.activePrompt;
    if (activePrompt && activePrompt.requestId === rawId) {
      const finalText = extractGeminiResultText(parsed['result']);
      if (finalText) {
        const delta = getGeminiTextDelta(activePrompt.fullResponse, finalText);
        if (delta) {
          activePrompt.sawAssistantOutput = true;
          activePrompt.fullResponse += delta;
          activePrompt.callbacks.onToken(delta);
        }
      }
    }

    pending.resolve(parsed['result']);
  }

  private handleSessionUpdate(entry: PersistentProcess, params: Record<string, unknown>): void {
    entry.lastSessionUpdateAt = Date.now();

    const activePrompt = entry.activePrompt;
    if (!activePrompt || !entry.sessionId) {
      return;
    }

    const sessionId = typeof params['sessionId'] === 'string' ? params['sessionId'] : null;
    if (!sessionId || sessionId !== entry.sessionId) {
      return;
    }

    const rawUpdate = params['update'];
    if (!rawUpdate || typeof rawUpdate !== 'object') {
      return;
    }

    const update = rawUpdate as Record<string, unknown>;
    const sessionUpdate = typeof update['sessionUpdate'] === 'string' ? update['sessionUpdate'] : '';
    activePrompt.lastOutputAt = Date.now();

    if (sessionUpdate === 'agent_message_chunk') {
      const candidate = extractUpdateText(update);
      if (!candidate) {
        return;
      }
      const delta = getGeminiTextDelta(activePrompt.fullResponse, candidate);
      if (!delta) {
        return;
      }
      activePrompt.sawAssistantOutput = true;
      activePrompt.fullResponse += delta;
      activePrompt.callbacks.onToken(delta);
      return;
    }

    if (sessionUpdate === 'agent_thought_chunk') {
      activePrompt.callbacks.onThought?.();
      return;
    }

    if (
      sessionUpdate === 'tool_call'
      || sessionUpdate === 'tool_call_update'
      || sessionUpdate === 'plan'
    ) {
      activePrompt.callbacks.onThought?.();
    }
  }

  private failPrompt(entry: PersistentProcess, error: Error, evictAfter: boolean): void {
    const activePrompt = entry.activePrompt;
    if (!activePrompt) {
      return;
    }

    const pending = entry.pendingRequests.get(activePrompt.requestId);
    if (pending) {
      entry.pendingRequests.delete(activePrompt.requestId);
      pending.reject(error);
    } else {
      clearInterval(activePrompt.timeoutHandle);
      entry.activePrompt = null;
      activePrompt.reject(error);
    }

    if (evictAfter) {
      this.evict(entry.poolKey);
    }
  }

  private async sendRequest(
    entry: PersistentProcess,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const requestId = entry.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        entry.pendingRequests.delete(requestId);
        reject(new Error(`Gemini ACP ${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      entry.pendingRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
      });

      try {
        this.writeJsonLine(entry, {
          jsonrpc: '2.0',
          id: requestId,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        entry.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeJsonLine(entry: PersistentProcess, payload: Record<string, unknown>): void {
    if (!entry.proc.stdin || entry.proc.stdin.destroyed || !this.isAlive(entry)) {
      throw new Error('Gemini ACP stdin is not writable.');
    }

    entry.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private rejectAllPending(entry: PersistentProcess, error: Error): void {
    if (entry.activePrompt) {
      clearInterval(entry.activePrompt.timeoutHandle);
      entry.activePrompt = null;
    }

    for (const [requestId, pending] of entry.pendingRequests.entries()) {
      entry.pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }

  private isAlive(entry: PersistentProcess): boolean {
    return entry.proc.exitCode === null && !entry.proc.killed;
  }

  private resetIdleTimer(entry: PersistentProcess): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    entry.idleTimer = setTimeout(() => {
      if (!entry.busy) {
        log.info('CLI pool: evicting idle ACP process', {
          poolKey: entry.poolKey,
          sessionId: entry.sessionId,
        });
        this.evict(entry.poolKey);
      }
    }, this.idleTimeoutMs);
  }

  private evict(poolKey: string): void {
    const entry = this.pool.get(poolKey);
    if (!entry) {
      return;
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    this.rejectAllPending(entry, new Error(`CLI pool entry evicted: ${poolKey}`));
    this.pool.delete(poolKey);

    try {
      if (this.isAlive(entry)) {
        entry.proc.kill('SIGTERM');
      }
    } catch {}

    try {
      entry.rl.close();
    } catch {}

    entry.pendingRequests.clear();
  }

  private evictOldestIdle(): void {
    let oldest: PersistentProcess | null = null;
    for (const entry of this.pool.values()) {
      if (entry.busy) {
        continue;
      }
      if (!oldest || entry.lastActivityAt < oldest.lastActivityAt) {
        oldest = entry;
      }
    }

    if (oldest) {
      log.info('CLI pool: evicting oldest idle ACP process to make room', {
        poolKey: oldest.poolKey,
      });
      this.evict(oldest.poolKey);
    }
  }

  kill(bindingKey: string): void {
    for (const [key] of this.pool) {
      if (key.startsWith(bindingKey + ':')) {
        this.evict(key);
      }
    }
  }

  killAll(): void {
    for (const [key] of this.pool) {
      this.evict(key);
    }
  }

  status(): PoolStatus {
    const now = Date.now();
    const processes: PoolStatus['processes'] = [];

    for (const entry of this.pool.values()) {
      processes.push({
        poolKey: entry.poolKey,
        busy: entry.busy,
        aliveMs: now - entry.spawnedAt,
        lastActivityMs: now - entry.lastActivityAt,
        allowedTools: entry.allowedTools,
      });
    }

    return {
      total: this.pool.size,
      busy: processes.filter((process) => process.busy).length,
      idle: processes.filter((process) => !process.busy).length,
      maxSize: this.maxSize,
      processes,
    };
  }
}
