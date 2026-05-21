/**
 * Shared HTTP client for MCP tools → daemon communication.
 * All tools call the daemon's localhost HTTP API.
 */

import * as http from 'node:http';
import type { Config } from '../shared/types.js';
import { resolveExtensionDir } from '../shared/config.js';
import { ensureDaemonRunning } from '../shared/daemon-runtime.js';
import { resolveMcpRoleContextFromEnv } from '../daemon/permissions.js';

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  config: Config;
  body?: object;
  timeoutMs?: number;
}

interface DaemonResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

/**
 * Make an HTTP request to the daemon's control API.
 * Returns a structured response. Never throws — returns error info instead.
 */
export async function daemonRequest(opts: RequestOptions): Promise<DaemonResponse> {
  const { method, path, config, body, timeoutMs } = opts;
  let tmpDir = process.cwd();
  try { tmpDir = __dirname; } catch {}
  const extensionDir = resolveExtensionDir(tmpDir);

  let response = await requestOnce({ method, path, config, body, timeoutMs });
  if ((response.data['error'] === 'daemon_offline' || response.data['error'] === 'daemon_timeout') && config.autoStartDaemon) {
    try {
      await ensureDaemonRunning(config, extensionDir);
      response = await requestOnce({ method, path, config, body, timeoutMs });
    } catch {
      return { ok: false, status: 0, data: { error: 'daemon_offline' } };
    }
  }

  return response;
}

async function requestOnce(opts: RequestOptions): Promise<DaemonResponse> {
  const { method, path, config, body, timeoutMs } = opts;
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: config.daemonPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...discordRoleHeaders(config),
          ...(method === 'POST' && config.daemonApiToken
            ? { Authorization: `Bearer ${config.daemonApiToken}` }
            : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: timeoutMs ?? 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const data = JSON.parse(raw);
            resolve({ ok: res.statusCode === 200, status: res.statusCode ?? 0, data });
          } catch {
            resolve({ ok: false, status: res.statusCode ?? 0, data: { error: raw } });
          }
        });
      },
    );

    req.on('error', () => {
      resolve({ ok: false, status: 0, data: { error: 'daemon_offline' } });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, data: { error: 'daemon_timeout' } });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function discordRoleHeaders(config: Config): Record<string, string> {
  const roleContext = resolveMcpRoleContextFromEnv(process.env, config);
  if (!roleContext) {
    return {};
  }

  return {
    'X-Gemini-Discord-Role': roleContext.role,
    'X-Gemini-Discord-Sender-Id': roleContext.senderDiscordId,
    'X-Gemini-Discord-Sender-Label': roleContext.senderDisplayLabel,
  };
}
