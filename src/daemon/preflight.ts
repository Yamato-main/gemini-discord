/**
 * Preflight checks — 9 validations, fail-fast.
 * Runs before any I/O or Discord connection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { log } from './log.js';

interface PreflightResult {
  geminiReachable: boolean;
  geminiVersion: string;
}

/**
 * Run all 9 preflight checks. Exits process on critical failures.
 * Returns non-critical state (gemini reachability) for degraded mode.
 */
export async function runPreflight(extensionDir: string): Promise<PreflightResult> {
  const envPath = path.join(extensionDir, '.env');

  // 1. .env exists
  if (!fs.existsSync(envPath)) {
    log.error('.env file not found', { path: envPath });
    log.error('Run: node dist/setup.cjs');
    process.exit(1);
  }

  // 2. .env permissions are 600
  try {
    const stats = fs.statSync(envPath);
    const mode = (stats.mode & 0o777).toString(8);
    if (mode !== '600') {
      log.warn('.env permissions too open, fixing', { was: mode, setting: '600' });
      fs.chmodSync(envPath, 0o600);
    }
  } catch (err) {
    log.warn('Could not check .env permissions', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Required env vars present
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envVars = parseEnvQuick(envContent);
  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_OWNER_IDS', 'ALLOWED_CHANNEL_IDS'];
  const missing = required.filter((k) => !envVars[k]?.trim());

  if (missing.length > 0) {
    log.error('Missing required env vars', { missing });
    process.exit(1);
  }

  // 4. ALLOWED_CHANNEL_IDS includes DISCORD_CHANNEL_ID
  const allowedIds = envVars['ALLOWED_CHANNEL_IDS']!.split(',').map((s) => s.trim());
  const channelId = envVars['DISCORD_CHANNEL_ID']!.trim();
  if (!allowedIds.includes(channelId)) {
    log.error('DISCORD_CHANNEL_ID must be in ALLOWED_CHANNEL_IDS', {
      channelId,
      allowedIds,
    });
    process.exit(1);
  }

  // 5. Node exists (sanity — we're running in it, logged for diagnostics)
  log.info('Node version', { version: process.version });

  // 6. gemini resolves in PATH (non-fatal — only needed for CLI backend)
  const geminiPath = envVars['GEMINI_PATH']?.trim() || 'gemini';
  const geminiBackend = envVars['GEMINI_BACKEND']?.trim() || '';
  const hasApiKey = Boolean(envVars['GEMINI_API_KEY']?.trim());
  const effectiveBackend = geminiBackend === 'cli' ? 'cli' : (geminiBackend === 'api' ? 'api' : (hasApiKey ? 'api' : 'cli'));

  if (effectiveBackend === 'cli') {
    try {
      execSync(`command -v ${shellEscape(geminiPath)}`, { stdio: 'pipe', shell: '/bin/sh' });
    } catch {
      log.error('gemini CLI not found in PATH (required for CLI backend)');
      log.error('Is Gemini CLI installed? https://github.com/google-gemini/gemini-cli');
      process.exit(1);
    }
  } else {
    // API backend — CLI is optional
    try {
      execSync(`command -v ${shellEscape(geminiPath)}`, { stdio: 'pipe', shell: '/bin/sh' });
      log.info('Gemini CLI available (fallback ready)');
    } catch {
      log.info('Gemini CLI not found — API-only mode (CLI backend unavailable)');
    }
  }

  // 6b. GEMINI_API_KEY validation (when using API backend)
  if (effectiveBackend === 'api' && !hasApiKey) {
    log.error('GEMINI_API_KEY required when using API backend. Set it in .env or switch GEMINI_BACKEND=cli');
    process.exit(1);
  }

  // 7. DAEMON_PORT is not already bound
  const port = parseInt(envVars['DAEMON_PORT'] ?? '18790', 10);
  const portInUse = await checkPortInUse(port);
  if (portInUse) {
    log.error('Port in use. Is the daemon already running?', { port });
    process.exit(1);
  }

  // 8. DAEMON_API_TOKEN is present and ≥32 chars
  let token = envVars['DAEMON_API_TOKEN']?.trim() ?? '';
  if (token.length < 32) {
    token = crypto.randomBytes(32).toString('hex');
    log.info('Generated new DAEMON_API_TOKEN');

    // Append to .env
    const line = `\nDAEMON_API_TOKEN=${token}\n`;
    fs.appendFileSync(envPath, line, { mode: 0o600 });
  }

  // 9. Gemini CLI version probe (non-fatal)
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

  log.info('Preflight complete', { checks: 9, backend: effectiveBackend, geminiReachable: true });

  return { geminiReachable: true, geminiVersion };
}

/**
 * Quick env parser for preflight (before full config load).
 */
function parseEnvQuick(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
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
