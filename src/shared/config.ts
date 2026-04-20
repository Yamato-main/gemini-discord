/**
 * .env parser → typed, frozen Config object.
 * Used by both daemon.ts and server.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config, MemoryScope } from './types.js';

const DEFAULT_BOSS_ID = '853141321774006282';

/**
 * Parse a .env file into a key-value map.
 * Handles comments, blank lines, and optional quoting.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const commentIndex = value.indexOf('#');
    if (commentIndex > 0 && value[commentIndex - 1] === ' ') {
      value = value.slice(0, commentIndex).trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Split a comma-separated string into a trimmed, non-empty array.
 */
export function splitIds(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function parseMemoryScope(value: string | undefined): MemoryScope {
  return value === 'channel' ? 'channel' : 'global';
}



function resolveBossId(explicitBossId: string | undefined, ownerIds: string[]): string {
  const explicit = explicitBossId?.trim();
  if (explicit) {
    return explicit;
  }

  if (ownerIds.includes(DEFAULT_BOSS_ID)) {
    return DEFAULT_BOSS_ID;
  }

  if (ownerIds.length === 1) {
    return ownerIds[0];
  }

  return ownerIds[0] ?? '';
}

/**
 * Load config from a .env file at the given directory.
 * Also merges any existing process.env values (Gemini CLI can inject settings).
 * Returns a frozen Config object.
 */
export function loadConfig(extensionDir: string): Config {
  const envPath = path.join(extensionDir, '.env');
  const fileVars = parseEnvFile(envPath);

  const get = (key: string, fallback = ''): string =>
    process.env[key] ?? fileVars[key] ?? fallback;

  const ownerIds = splitIds(get('DISCORD_OWNER_IDS'));
  const allowedUserIds = splitIds(get('DISCORD_ALLOWED_USER_IDS'));

  const config: Config = {
    discordBotToken: get('DISCORD_BOT_TOKEN'),
    discordChannelId: get('DISCORD_CHANNEL_ID'),
    ownerIds,
    discordBossId: resolveBossId(get('DISCORD_BOSS_ID'), ownerIds),
    allowedChannelIds: splitIds(get('ALLOWED_CHANNEL_IDS')),

    allowedUserIds: allowedUserIds.length > 0 ? allowedUserIds : ownerIds,
    allowedAgentIds: splitIds(get('DISCORD_ALLOWED_AGENT_IDS')),

    daemonApiToken: get('DAEMON_API_TOKEN'),

    peerAgentId: get('DISCORD_PEER_AGENT_ID', '1485836823170121880'),
    reportingChannelId: get('DISCORD_REPORTING_CHANNEL_ID', '1493481295051886697'),

    discordPrefix: get('DISCORD_PREFIX'),
    discordResetCmd: get('DISCORD_RESET_CMD', '!reset'),
    daemonPort: parseInt(get('DAEMON_PORT', '18790'), 10),
    geminiPath: get('GEMINI_PATH', 'gemini'),
    geminiModel: get('GEMINI_MODEL', 'gemini-3.1-flash-lite-preview'),
    geminiTimeoutMs: parseInt(get('GEMINI_TIMEOUT_MS', '300000'), 10),
    geminiMaxConcurrent: parseInt(get('GEMINI_MAX_CONCURRENT', '3'), 10),
    conversationHistoryLength: parseInt(get('CONVERSATION_HISTORY_LENGTH', '30'), 10),
    promptHistoryMessageLimit: parseInt(get('PROMPT_HISTORY_MAX_MESSAGES', '12'), 10),
    promptHistoryCharBudget: parseInt(get('PROMPT_HISTORY_MAX_CHARS', '6000'), 10),
    streaming: parseBoolean(get('STREAMING', 'true'), true),
    queueMaxDepth: parseInt(get('QUEUE_MAX_DEPTH', '20'), 10),
    enableDMs: parseBoolean(get('ENABLE_DMS', 'true'), true),
    requireMention: parseBoolean(get('REQUIRE_MENTION', 'true'), true),
    respondToReplies: parseBoolean(get('RESPOND_TO_REPLIES', 'true'), true),
    memoryScope: parseMemoryScope(get('MEMORY_SCOPE', 'channel')),
    autoStartDaemon: parseBoolean(get('AUTO_START_DAEMON', 'true'), true),
    useGeminiCliSessions: parseBoolean(get('USE_GEMINI_CLI_SESSIONS', 'false'), false),
    cliIdleTimeoutMs: parseInt(get('CLI_IDLE_TIMEOUT_MS', '300000'), 10),
  };

  return config;
}

/**
 * Resolve the extension directory from a file path or directory.
 * Works from both src/ (dev) and dist/ (bundled) contexts.
 * When bundled with esbuild CJS, pass __dirname.
 */
export function resolveExtensionDir(fromDir: string): string {
  let dir = fromDir;
  if (dir.startsWith('file://')) {
    dir = path.dirname(new URL(dir).pathname);
  }

  if (path.basename(dir) === 'dist') {
    return path.dirname(dir);
  }

  let current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'gemini-extension.json'))) {
      return current;
    }
    current = path.dirname(current);
  }

  return dir;
}
/**
 * Update the GEMINI_MODEL value in the .env file.
 */
export async function updateEnvModel(extensionDir: string, model: string): Promise<void> {
  const envPath = path.join(extensionDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  let found = false;

  const newLines = lines.map((line) => {
    if (line.trim().startsWith('GEMINI_MODEL=')) {
      found = true;
      return `GEMINI_MODEL=${model}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`GEMINI_MODEL=${model}`);
  }

  fs.writeFileSync(envPath, newLines.join('\n'));
}

