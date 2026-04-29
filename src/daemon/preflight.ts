/**
 * Preflight checks — fail-fast on configuration that prevents startup.
 * Runs before any I/O or Discord connection.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import { execSync } from 'node:child_process';
import { log } from './log.js';
import { resolveConfigEnvMap } from '../shared/config.js';

interface PreflightResult {
  geminiReachable: boolean;
  geminiVersion: string;
}

/**
 * Run startup preflight checks. Exits process on critical failures.
 * Returns non-critical state (gemini reachability) for degraded mode.
 */
export async function runPreflight(extensionDir: string): Promise<PreflightResult> {
  const envVars = resolveConfigEnvMap(extensionDir);
  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_OWNER_IDS'];
  const missing = required.filter((k) => !envVars[k]?.trim());

  if (missing.length > 0) {
    log.error('Missing required extension settings', { missing });
    log.error('Run `gemini extensions config gemini-discord` or create a local `.env` file for development.');
    process.exit(1);
  }

  // 4. DISCORD_ALLOWED_CHANNEL_IDS includes DISCORD_CHANNEL_ID when explicitly configured.
  const allowedIds = (envVars['DISCORD_ALLOWED_CHANNEL_IDS'] || envVars['DISCORD_CHANNEL_ID'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const channelId = envVars['DISCORD_CHANNEL_ID']!.trim();
  if (!allowedIds.includes(channelId)) {
    log.error('DISCORD_CHANNEL_ID must be in DISCORD_ALLOWED_CHANNEL_IDS', {
      channelId,
      allowedIds,
    });
    process.exit(1);
  }

  // 5. Node exists (sanity — we're running in it, logged for diagnostics)
  log.info('Node version', { version: process.version });

  // 6. gemini resolves in PATH.
  const geminiPath = envVars['GEMINI_PATH']?.trim() || 'gemini';
  try {
    execSync(`command -v ${shellEscape(geminiPath)}`, { stdio: 'pipe', shell: '/bin/sh' });
  } catch {
    log.error('gemini CLI not found in PATH');
    log.error('Install and authenticate Gemini CLI before using gemini-discord.');
    process.exit(1);
  }

  // 7. DAEMON_PORT is not already bound
  const port = parseInt(envVars['DAEMON_PORT'] ?? '18790', 10);
  const portInUse = await checkPortInUse(port);
  if (portInUse) {
    log.error('Port in use. Is the daemon already running?', { port });
    process.exit(1);
  }

  // 8. Gemini CLI version probe (non-fatal)
  let geminiVersion = 'unknown';

  try {
    const versionOut = execSync(`${shellEscape(geminiPath)} --version 2>/dev/null || true`, {
      stdio: 'pipe',
      timeout: 10000,
      shell: '/bin/sh',
    }).toString().trim();
    geminiVersion = versionOut || 'unknown';
    log.info('Gemini CLI version', { version: geminiVersion });
  } catch {
    log.warn('Could not determine gemini CLI version');
  }

  log.info('Preflight complete', { checks: 8, geminiReachable: true });

  return { geminiReachable: true, geminiVersion };
}

/**
 * Check if a port is already bound on 127.0.0.1.
 */
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
