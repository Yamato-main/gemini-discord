/**
 * Persistent CLI Process Pool — keeps Gemini CLI processes alive between messages.
 *
 * First message in a session pays the CLI cold-start (~800-2000ms).
 * Subsequent messages reuse the warm process via stdin/stdout (~50ms).
 *
 * Lifecycle:
 * 1. Spawn on first message — interactive mode with stream-json output
 * 2. Reuse on subsequent messages — prompt via stdin, response via stdout
 * 3. Idle timeout — SIGTERM after configurable idle period
 * 4. Crash recovery — auto-evict, next message triggers fresh spawn
 * 5. Max pool size — capped at geminiMaxConcurrent
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

interface PersistentProcess {
  proc: ChildProcess;
  poolKey: string;
  rl: readline.Interface;
  busy: boolean;
  spawnedAt: number;
  lastActivityAt: number;
  idleTimer: NodeJS.Timeout | null;
  allowedTools: string;
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

/**
 * Resolve the allowed-tools flag based on Boss status and tool mode.
 * This is a hard CLI-level boundary — non-Boss users can NEVER get shell access.
 */
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

/**
 * Build a pool key that incorporates session + tool-access level.
 * This ensures a non-Boss user can never inherit a Boss-level process.
 */
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

export class CliProcessPool {
  private pool = new Map<string, PersistentProcess>();
  private maxSize: number;
  private idleTimeoutMs: number;
  private config: Config;
  private supportsInteractive: boolean | null = null; // null = untested

  constructor(config: Config) {
    this.config = config;
    this.maxSize = config.geminiMaxConcurrent;
    this.idleTimeoutMs = config.cliIdleTimeoutMs;
  }

  /**
   * Send a prompt to a persistent CLI process and stream the response.
   * Spawns a new process if none exists for this session key + tool tier.
   */
  async send(
    bindingKey: string,
    prompt: string,
    callbacks: StreamCallbacks,
    opts: PoolSendOptions,
  ): Promise<string> {
    const allowedTools = resolveAllowedTools(opts.isBoss, opts.toolMode);
    const poolKey = buildPoolKey(bindingKey, allowedTools);

    let proc = this.pool.get(poolKey);

    // Reuse existing process if alive and not busy
    if (proc && !proc.busy && proc.proc.exitCode === null) {
      proc.busy = true;
      proc.lastActivityAt = Date.now();
      this.resetIdleTimer(proc);
      log.info('CLI pool: reusing warm process', { poolKey, aliveMs: Date.now() - proc.spawnedAt });
    } else {
      // Evict dead or busy-stuck process
      if (proc) {
        this.evict(poolKey);
      }

      // Evict oldest idle if at capacity
      if (this.pool.size >= this.maxSize) {
        this.evictOldestIdle();
      }

      proc = await this.spawnProcess(poolKey, allowedTools, opts);
      this.pool.set(poolKey, proc);
    }

    try {
      const response = await this.collectResponse(proc, prompt, callbacks, opts);
      proc.busy = false;
      proc.lastActivityAt = Date.now();
      this.resetIdleTimer(proc);
      return response;
    } catch (err) {
      // On error, kill the process — don't risk reusing a corrupted state
      this.evict(poolKey);
      throw err;
    }
  }

  /**
   * Spawn a persistent interactive Gemini CLI process.
   *
   * Uses one-shot mode (-p flag) as fallback since interactive mode
   * behavior with stream-json varies across CLI versions.
   * Session resume (-r latest) rehydrates context for returning sessions.
   */
  private async spawnProcess(
    poolKey: string,
    allowedTools: string,
    _opts: PoolSendOptions,
  ): Promise<PersistentProcess> {
    const spawnedAt = Date.now();

    log.info('CLI pool: initializing process entry', {
      poolKey,
      model: this.config.geminiModel,
      allowedTools,
    });

    // We initialize a "lazy" entry. The actual process is spawned in collectResponse
    // to avoid the redundant spawn-kill-respawn cycle.
    const entry: PersistentProcess = {
      proc: null as any, // Will be spawned in collectResponse
      poolKey,
      rl: null as any,
      busy: true,
      spawnedAt,
      lastActivityAt: spawnedAt,
      idleTimer: null,
      allowedTools,
    };

    return entry;
  }

  /**
   * Send a prompt and collect the streaming response.
   * Uses one-shot spawn per prompt for maximum reliability.
   */
  private async collectResponse(
    entry: PersistentProcess,
    prompt: string,
    callbacks: StreamCallbacks,
    opts: PoolSendOptions,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let fullResponse = '';
      let resolved = false;
      let sawAssistantOutput = false;
      let lastOutputAt = Date.now();
      const hasAttachments = (opts.attachmentPaths?.length ?? 0) > 0;

      // Build args for one-shot invocation
      const args = [
        '--model', this.config.geminiModel,
        '--output-format', 'stream-json',
        '--allowed-tools', entry.allowedTools,
        '--approval-mode', 'yolo',
      ];

      // Add session resume if available
      if (opts.resumeSessionId) {
        args.push('-r', opts.resumeSessionId);
      }

      args.push('-p', buildGeminiCliPrompt(prompt, opts.attachmentPaths));

      const proc = spawn(this.config.geminiPath, args, {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Update entry to point to real process  
      entry.proc = proc;
      const rl = readline.createInterface({ input: proc.stdout! });
      entry.rl = rl;

      const MAX_TOTAL_TIMEOUT_MS = this.config.geminiTimeoutMs;
      const FIRST_OUTPUT_TIMEOUT_MS = hasAttachments
        ? Math.min(MAX_TOTAL_TIMEOUT_MS, 240_000)
        : 120_000;
      const POST_OUTPUT_TIMEOUT_MS = 120_000;
      
      const activityCheck = setInterval(() => {
        const idleMs = Date.now() - lastOutputAt;
        const totalMs = Date.now() - entry.lastActivityAt;
        
        if (!sawAssistantOutput && idleMs > FIRST_OUTPUT_TIMEOUT_MS) {
          if (!resolved) {
            resolved = true;
            clearInterval(activityCheck);
            proc.kill('SIGTERM');
            reject(new Error(`Gemini stalled — no output for ${Math.round(idleMs / 1000)}s`));
          }
        } else if (sawAssistantOutput && idleMs > POST_OUTPUT_TIMEOUT_MS) {
          if (!resolved) {
            resolved = true;
            clearInterval(activityCheck);
            proc.kill('SIGTERM');
            reject(new Error(`Gemini stalled — no output for ${Math.round(idleMs / 1000)}s`));
          }
        } else if (totalMs > MAX_TOTAL_TIMEOUT_MS) {
          if (!resolved) {
            resolved = true;
            clearInterval(activityCheck);
            proc.kill('SIGTERM');
            reject(new Error(`Gemini timed out after ${Math.round(totalMs / 1000)}s total`));
          }
        }
      }, 5000);

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      rl.on('line', (line: string) => {
        if (resolved) return;
        lastOutputAt = Date.now();

        // Fast-path: skip non-JSON lines
        if (line.length < 3 || line[0] !== '{') return;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }

        const type = parsed['type'];
        const role = parsed['role'];
        const appendAssistantText = (candidate: string) => {
          const delta = getGeminiTextDelta(fullResponse, candidate);
          if (!delta) {
            return;
          }
          sawAssistantOutput = true;
          fullResponse += delta;
          callbacks.onToken(delta);
        };

        if (type === 'message' && (role === 'assistant' || role === 'model')) {
          const parts = parsed['parts'] as Array<{ text?: string; thought?: boolean }> | undefined;
          if (parts) {
            for (const part of parts) {
              if (part.text && !part.thought) {
                appendAssistantText(part.text);
              } else if (part.thought) {
                callbacks.onThought?.();
              }
            }
          }

          const isThought = parsed['thought'] === true;
          const text = parsed['text'] as string | undefined;
          if (text && !parts) {
            if (isThought) {
              callbacks.onThought?.();
            } else {
              appendAssistantText(text);
            }
          }

          const content = parsed['content'] as string | undefined;
          if (content && !parts && !text) {
            if (isThought) {
              callbacks.onThought?.();
            } else {
              appendAssistantText(content);
            }
          }
          return;
        }

        if (type === 'init') {
          const sessionId = parsed['session_id'];
          if (typeof sessionId === 'string') {
            opts.onSessionId?.(sessionId);
          }
          return;
        }

        if (type === 'result') {
          const resultText = extractGeminiResultText(parsed['result']);
          if (resultText) {
            appendAssistantText(resultText);
          }
          if (parsed['error'] && !resolved) {
            resolved = true;
            clearInterval(activityCheck);
            reject(new Error(String(parsed['error'])));
          }
          return;
        }

        if (type === 'tool_call' || type === 'tool_execution' || type === 'call_tool' ||
            type === 'tool_use' || type === 'tool_result') {
          callbacks.onThought?.();
          return;
        }
      });

      proc.on('close', (code) => {
        clearInterval(activityCheck);
        rl.close();

        if (resolved) return;
        resolved = true;

        if (code !== 0 && !sawAssistantOutput) {
          reject(new Error(`Gemini exited with code ${code}. ${stderr.slice(0, 300)}`));
          return;
        }

        if (!sawAssistantOutput) {
          reject(new Error('Gemini returned no assistant output for this turn.'));
          return;
        }

        resolve(fullResponse);
      });

      proc.on('error', (err) => {
        clearInterval(activityCheck);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to spawn gemini: ${err.message}`));
        }
      });
    });
  }

  private resetIdleTimer(entry: PersistentProcess): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }
    entry.idleTimer = setTimeout(() => {
      if (!entry.busy) {
        log.info('CLI pool: evicting idle process', { poolKey: entry.poolKey });
        this.evict(entry.poolKey);
      }
    }, this.idleTimeoutMs);
  }

  private evict(poolKey: string): void {
    const entry = this.pool.get(poolKey);
    if (!entry) return;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try {
      if (entry.proc) entry.proc.kill('SIGTERM');
    } catch {}
    if (entry.rl) entry.rl.close();
    this.pool.delete(poolKey);
  }

  private evictOldestIdle(): void {
    let oldest: PersistentProcess | null = null;
    for (const entry of this.pool.values()) {
      if (entry.busy) continue;
      if (!oldest || entry.lastActivityAt < oldest.lastActivityAt) {
        oldest = entry;
      }
    }
    if (oldest) {
      log.info('CLI pool: evicting oldest idle to make room', { poolKey: oldest.poolKey });
      this.evict(oldest.poolKey);
    }
  }

  /** Kill a specific binding's process (for /reset, /kill). */
  kill(bindingKey: string): void {
    for (const [key] of this.pool) {
      if (key.startsWith(bindingKey + ':')) {
        this.evict(key);
      }
    }
  }

  /** Kill all processes (daemon shutdown). */
  killAll(): void {
    for (const [key] of this.pool) {
      this.evict(key);
    }
  }

  /** Get pool status for /status and /pool commands. */
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
      busy: processes.filter(p => p.busy).length,
      idle: processes.filter(p => !p.busy).length,
      maxSize: this.maxSize,
      processes,
    };
  }
}
