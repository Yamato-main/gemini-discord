/**
 * Gemini CLI invocation — session-aware streaming and non-streaming paths.
 * Binds Gemini CLI sessions to Discord workspaces so a server/DM feels like a
 * persistent Gemini CLI context instead of a stateless prompt replay.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import type { Config } from '../shared/types.js';
import { log } from './log.js';
import type { ToolMode } from './tool-mode.js';
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
  'schedule_reminder',
  'schedule_cron_job',
  'list_cron_jobs',
  'delete_cron_job',
].join(',');

interface StreamingCallbacks {
  onToken: (token: string) => void;
  onThought?: () => void;
}

function appendHeadlessIsolationArgs(args: string[]): void {
  args.push('--extensions', 'gemini-discord');
  args.push('--allowed-mcp-server-names', 'discord-bridge');
}

export interface GeminiInvocationOptions {
  cwd: string;
  useResume: boolean;
  resumeSessionId?: string | null;
  isBoss: boolean;
  attachmentPaths?: string[];
  onSessionId?: (sessionId: string) => void;
  toolMode?: ToolMode;
}

export async function callGeminiStreaming(
  prompt: string,
  config: Config,
  callbacks: StreamingCallbacks,
  options: GeminiInvocationOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullResponse = '';
    let resolved = false;
    let sawAssistantOutput = false;

    const args = buildGeminiArgs(prompt, config, 'stream-json', options);
    const proc = spawn(config.geminiPath, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        reject(new Error(`Gemini timed out after ${config.geminiTimeoutMs / 1000}s`));
      }
    }, config.geminiTimeoutMs);

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const rl = readline.createInterface({ input: proc.stdout! });

    rl.on('line', (line: string) => {
      if (resolved) return;

      // Fast-path: skip obvious non-data lines without JSON.parse overhead.
      // All valid Gemini stream-json lines start with {"type":
      if (line.length < 10 || !line.startsWith('{"type":')) {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      const type = parsed['type'];
      const role = parsed['role'];

      if (type === 'init') {
        const sessionId = parsed['session_id'];
        if (typeof sessionId === 'string') {
          options.onSessionId?.(sessionId);
        }
        return;
      }

      if (type === 'message' && role === 'assistant') {
        const parts = parsed['parts'] as Array<{ text?: string; thought?: boolean }> | undefined;
        if (parts) {
          for (const part of parts) {
            if (part.text && !part.thought) {
              sawAssistantOutput = true;
              fullResponse += part.text;
              callbacks.onToken(part.text);
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
            sawAssistantOutput = true;
            fullResponse += text;
            callbacks.onToken(text);
          }
        }

        const content = parsed['content'] as string | undefined;
        if (content && !parts && !text) {
          if (isThought) {
            callbacks.onThought?.();
          } else {
            sawAssistantOutput = true;
            fullResponse += content;
            callbacks.onToken(content);
          }
        }
        return;
      }

      if (type === 'result') {
        if (parsed['error']) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(new Error(String(parsed['error'])));
          }
          return;
        }

        const finalText = extractGeminiResultText(parsed);
        if (finalText) {
          const delta = getGeminiTextDelta(fullResponse, finalText);
          if (delta) {
            sawAssistantOutput = true;
            fullResponse += delta;
            callbacks.onToken(delta);
          }
        }
        return;
      }

      if (type === 'message' && role === 'user') {
        return;
      }

      if (
        type === 'tool_call' ||
        type === 'tool_execution' ||
        type === 'call_tool' ||
        type === 'tool_use' ||
        type === 'tool_result'
      ) {
        callbacks.onThought?.();
        return;
      }

      log.warn('Unknown stream-json line', { type, raw: line.slice(0, 200) });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      rl.close();

      if (resolved) return;
      resolved = true;

      if (code !== 0 && !sawAssistantOutput) {
        reject(withResumeFallbackHint(new Error(`Gemini exited with code ${code}. ${stderr.slice(0, 300)}`), options));
        return;
      }

      resolve(fullResponse);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to spawn gemini: ${err.message}`));
      }
    });
  });
}

export async function callGeminiFull(
  prompt: string,
  config: Config,
  options: GeminiInvocationOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const args = buildGeminiArgs(prompt, config, 'json', options);
    const proc = spawn(config.geminiPath, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        reject(new Error(`Gemini timed out after ${config.geminiTimeoutMs / 1000}s`));
      }
    }, config.geminiTimeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;

      if (code !== 0) {
        reject(withResumeFallbackHint(new Error(`Gemini exited with code ${code}. ${stderr.slice(0, 300)}`), options));
        return;
      }

      try {
        let jsonPayload = stdout;
        const firstBrace = stdout.indexOf('{');
        const lastBrace = stdout.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonPayload = stdout.slice(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(jsonPayload);
        const response = parsed['response'] ?? parsed['text'] ?? '';
        if (response) {
          resolve(String(response));
          return;
        }
        resolve(stdout.trim());
      } catch {
        // If it's truly not parsable JSON, just return what we got
        // We strip out the JSON braces if it looks like broken structured data
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to spawn gemini: ${err.message}`));
      }
    });
  });
}

function buildGeminiArgs(
  prompt: string,
  config: Config,
  outputFormat: 'stream-json' | 'json',
  options: GeminiInvocationOptions,
): string[] {
  const args = ['--model', config.geminiModel, '--output-format', outputFormat];

  args.push('--allowed-tools', resolveAllowedTools(options.isBoss, options.toolMode ?? 'chat'));

  // Auto-approve all tool operations for headless daemon — stdin is 'ignore'
  // so 'default' mode would hang waiting for confirmation. Security boundary
  // is now strictly enforced by the --allowed-tools filter above.
  args.push('--approval-mode', 'yolo');
  appendHeadlessIsolationArgs(args);

  const resumeSessionId = options.resumeSessionId?.trim();
  if (options.useResume && resumeSessionId) {
    args.push('-r', resumeSessionId);
  }

  args.push('-p', buildGeminiCliPrompt(prompt, options.attachmentPaths));
  return args;
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

function withResumeFallbackHint(error: Error, options: GeminiInvocationOptions): Error {
  if (!options.useResume) {
    return error;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes('no session') ||
    message.includes('session not found') ||
    message.includes('resume') ||
    message.includes('latest')
  ) {
    return new Error(`resume_session_unavailable: ${error.message}`);
  }

  return error;
}
