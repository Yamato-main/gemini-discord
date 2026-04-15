/**
 * Gemini CLI invocation — session-aware streaming and non-streaming paths.
 * Binds Gemini CLI sessions to Discord workspaces so a server/DM feels like a
 * persistent Gemini CLI context instead of a stateless prompt replay.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import type { Config } from '../shared/types.js';
import { log } from './log.js';

interface StreamingCallbacks {
  onToken: (token: string) => void;
}

export interface GeminiInvocationOptions {
  cwd: string;
  useResume: boolean;
  attachmentPaths?: string[];
  onSessionId?: (sessionId: string) => void;
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

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        log.warn('Unparseable stream-json line', { raw: line.slice(0, 200) });
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
            }
          }
        }

        const text = parsed['text'] as string | undefined;
        if (text && !parts) {
          sawAssistantOutput = true;
          fullResponse += text;
          callbacks.onToken(text);
        }

        const content = parsed['content'] as string | undefined;
        if (content && !parts && !text) {
          sawAssistantOutput = true;
          fullResponse += content;
          callbacks.onToken(content);
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
        }
        return;
      }

      if (type === 'message' && role === 'user') {
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
        const parsed = JSON.parse(stdout);
        const response = parsed['response'] ?? parsed['text'] ?? '';
        resolve(String(response));
      } catch {
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
  const args = ['--model', config.geminiModel, '-y', '--output-format', outputFormat];

  if (options.useResume) {
    args.push('-r', 'latest');
  }

  args.push('-p', buildGeminiInput(prompt, options.attachmentPaths));
  return args;
}

function buildGeminiInput(prompt: string, attachmentPaths: string[] = []): string {
  if (attachmentPaths.length === 0) {
    return prompt;
  }

  const manifest = attachmentPaths
    .map((filePath, index) => `- Image ${index + 1}: ${filePath}`)
    .join('\n');

  return `[Discord attachment workspace]
The following relative image files are available inside the current Gemini CLI project root.
Inspect them directly before answering if they matter to the request.
${manifest}

${prompt}`;
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
