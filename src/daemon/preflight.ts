/**
 * Preflight checks — fail-fast on configuration that prevents startup.
 * Runs before any I/O or Discord connection.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import { execSync } from 'node:child_process';
import { log } from './log.js';
import { resolveConfigEnvMap } from '../shared/config.js';
import { ENV, REQUIRED_DAEMON_ENV_KEYS } from '../shared/config-vars.js';
import { validateBossConfig } from './permissions.js';

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
  const required = REQUIRED_DAEMON_ENV_KEYS;
  const missing = required.filter((k) => !envVars[k]?.trim());

  if (missing.length > 0) {
    log.error('Missing required extension settings', { missing });
    log.error('Run `npm run setup` or create a local `.env` file for development.');
    process.exit(1);
  }

  // 4. DISCORD_ALLOWED_CHANNEL_IDS includes DISCORD_CHANNEL_ID when explicitly configured.
  const channelId = envVars[ENV.DISCORD_CHANNEL_ID]?.trim() ?? '';
  if (channelId) {
    const allowedIds = (envVars[ENV.DISCORD_ALLOWED_CHANNEL_IDS] || envVars[ENV.DISCORD_CHANNEL_ID] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowedIds.includes(channelId)) {
      log.error('DISCORD_CHANNEL_ID must be in DISCORD_ALLOWED_CHANNEL_IDS', {
        channelId,
        allowedIds,
      });
      process.exit(1);
    }
  } else {
    log.info('Primary Discord channel not configured yet; onboarding will auto-manage it after the bot connects.');
  }

  if (!envVars[ENV.DISCORD_OWNER_IDS]?.trim()) {
    log.info('Discord owners not configured yet; the daemon will try to infer the application owner automatically.');
  }

  const bossConfig = validateBossConfig(envVars[ENV.DISCORD_BOSS_USER_ID]);
  if (!bossConfig.valid) {
    log.warn('DISCORD_BOSS_USER_ID is missing or malformed; privileged Discord actions will fail closed.', {
      reason: bossConfig.reason,
    });
  }

  // 5. Node exists (sanity — we're running in it, logged for diagnostics)
  log.info('Node version', { version: process.version });

  // 6. gemini resolves in PATH.
  const geminiPath = envVars[ENV.GEMINI_PATH]?.trim() || 'gemini';
  try {
    execSync(`command -v ${shellEscape(geminiPath)}`, { stdio: 'pipe', shell: '/bin/sh' });
  } catch {
    log.error('gemini CLI not found in PATH');
    log.error('Install and authenticate Gemini CLI before using gemini-discord.');
    process.exit(1);
  }

  // 7. DAEMON_PORT is not already bound
  const port = parseInt(envVars[ENV.DAEMON_PORT] ?? '18790', 10);
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
 * Check if a port already has an active listener on 127.0.0.1.
 *
 * This intentionally uses a client connection probe instead of briefly binding
 * the port ourselves. Binding during preflight can race with the real control
 * API startup and leave the daemon tripping over its own availability check.
 */
export function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (inUse: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(inUse);
    };

    socket.setTimeout(750);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'EPERM' || error.code === 'EACCES') {
        finish(false);
        return;
      }
      finish(true);
    });
  });
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
