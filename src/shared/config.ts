/**
 * .env parser → typed, frozen Config object.
 * Used by both daemon.ts and server.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Config, GeminiSessionBindingScope, MemoryScope } from './types.js';
import { ensureRuntimePaths, resolveRuntimePaths } from './runtime-paths.js';
import {
  readManagedConfigFile,
  updateManagedConfigFile,
  type ManagedConfigFile,
  type ManagedDiscordMetadata,
} from './managed-config.js';
import { CONFIG_ENV_KEYS, ENV, type ConfigEnvKey } from './config-vars.js';

const LEGACY_ENV_ALIASES: Partial<Record<ConfigEnvKey, string[]>> = {
  [ENV.DISCORD_ALLOWED_CHANNEL_IDS]: ['ALLOWED_CHANNEL_IDS'],
};


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

function parseGeminiSessionBindingScope(value: string | undefined): GeminiSessionBindingScope {
  switch (value) {
    case 'global':
    case 'server':
    case 'channel':
      return value;
    default:
      return 'channel';
  }
}

function resolveAdminId(explicitAdminId: string | undefined, ownerIds: string[]): string {
  const explicit = explicitAdminId?.trim();
  if (explicit) {
    return explicit;
  }

  if (ownerIds.length === 1) {
    return ownerIds[0];
  }

  return ownerIds[0] ?? '';
}

function normalizeConfigMap(input: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const key of CONFIG_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key].trim() !== '') {
      normalized[key] = input[key];
      continue;
    }

    const aliases = LEGACY_ENV_ALIASES[key] ?? [];
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(input, alias) && input[alias].trim() !== '') {
        normalized[key] = input[alias];
        break;
      }
    }
  }

  return normalized;
}

function collectProcessEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of CONFIG_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
    const aliases = LEGACY_ENV_ALIASES[key] ?? [];
    for (const alias of aliases) {
      const aliasValue = process.env[alias];
      if (aliasValue !== undefined && result[key] === undefined) {
        result[key] = aliasValue;
      }
    }
  }
  return result;
}

export function resolveConfigEnvMap(extensionDir: string): Record<string, string> {
  const runtimePaths = ensureRuntimePaths(extensionDir);
  const managedConfig = readManagedConfigFile(runtimePaths.managedConfigFile);
  const snapshotVars = normalizeConfigMap(managedConfig.env);
  const processVars = normalizeConfigMap(collectProcessEnv());
  const fileVars = normalizeConfigMap(parseEnvFile(path.join(extensionDir, '.env')));
  const resolved = {
    ...fileVars,
    ...snapshotVars,
    ...processVars,
  };

  try {
    persistManagedConfig(runtimePaths.managedConfigFile, managedConfig, resolved);
  } catch {
    // Best-effort persistence only.
  }

  return resolved;
}

/**
 * Load config from a .env file at the given directory.
 * Also merges persisted runtime settings and any existing process.env values.
 * Returns a frozen Config object.
 */
export function loadConfig(extensionDir: string): Config {
  const envVars = resolveConfigEnvMap(extensionDir);
  const runtimePaths = ensureRuntimePaths(extensionDir);
  const managedConfig = readManagedConfigFile(runtimePaths.managedConfigFile);

  const get = (key: string, fallback = ''): string => {
    const envValue = envVars[key];
    return envValue === undefined ? fallback : envValue;
  };

  const ownerIds = splitIds(get(ENV.DISCORD_OWNER_IDS));
  const primaryChannelId = get(ENV.DISCORD_CHANNEL_ID);
  const configuredServerId = get(ENV.DISCORD_SERVER_ID);
  const configuredAllowedChannelIds = splitIds(get(ENV.DISCORD_ALLOWED_CHANNEL_IDS));
  const allowedUserIds = splitIds(get(ENV.DISCORD_ALLOWED_USER_IDS));
  const hasInstallSettings = Boolean(
    get(ENV.DISCORD_BOT_TOKEN).trim()
    && get(ENV.DISCORD_OWNER_IDS).trim()
    && get(ENV.DISCORD_SERVER_ID).trim(),
  );

  const config: Config = {
    discordBotToken: get(ENV.DISCORD_BOT_TOKEN),
    discordChannelId: primaryChannelId,
    discordServerId: configuredServerId || managedConfig.discord.primaryGuildId || '',
    discordServerName: managedConfig.discord.primaryGuildName ?? '',
    discordBossUserId: get(ENV.DISCORD_BOSS_USER_ID).trim(),
    ownerIds,
    discordAdminId: resolveAdminId(get(ENV.DISCORD_ADMIN_ID), ownerIds),
    allowedChannelIds: configuredAllowedChannelIds.length > 0
      ? configuredAllowedChannelIds
      : (primaryChannelId ? [primaryChannelId] : []),

    allowedUserIds: allowedUserIds.length > 0 ? allowedUserIds : ownerIds,
    allowedAgentIds: splitIds(get(ENV.DISCORD_ALLOWED_AGENT_IDS)),

    daemonApiToken: (() => {
      let token = get(ENV.DAEMON_API_TOKEN);
      if (token) return token;

      const tokenPath = runtimePaths.daemonTokenFile;
      if (fs.existsSync(tokenPath)) {
        return fs.readFileSync(tokenPath, 'utf-8').trim();
      }
      token = crypto.randomBytes(32).toString('hex');
      try {
        fs.writeFileSync(tokenPath, token, { mode: 0o600 });
      } catch (e) {
        // Ignore if we can't write, we'll just use the token in memory
      }
      return token;
    })(),

    discordPrefix: get(ENV.DISCORD_PREFIX),
    discordResetCmd: get(ENV.DISCORD_RESET_CMD, '!reset'),
    daemonPort: parseInt(get(ENV.DAEMON_PORT, '18790'), 10),
    geminiPath: get(ENV.GEMINI_PATH, 'gemini'),
    geminiModel: get(ENV.GEMINI_MODEL, 'gemini-3.1-flash-lite-preview'),
    geminiTimeoutMs: parseInt(get(ENV.GEMINI_TIMEOUT_MS, '900000'), 10),
    geminiMaxConcurrent: parseInt(get(ENV.GEMINI_MAX_CONCURRENT, '3'), 10),
    conversationHistoryLength: parseInt(get(ENV.CONVERSATION_HISTORY_LENGTH, '30'), 10),
    promptHistoryMessageLimit: parseInt(get(ENV.PROMPT_HISTORY_MAX_MESSAGES, '12'), 10),
    promptHistoryCharBudget: parseInt(get(ENV.PROMPT_HISTORY_MAX_CHARS, '6000'), 10),
    streaming: parseBoolean(get(ENV.STREAMING, 'true'), true),
    queueMaxDepth: parseInt(get(ENV.QUEUE_MAX_DEPTH, '20'), 10),
    enableDMs: parseBoolean(get(ENV.ENABLE_DMS, 'true'), true),
    requireMention: parseBoolean(get(ENV.REQUIRE_MENTION, 'true'), true),
    respondToReplies: parseBoolean(get(ENV.RESPOND_TO_REPLIES, 'true'), true),
    memoryScope: parseMemoryScope(get(ENV.MEMORY_SCOPE, 'channel')),
    autoStartDaemon: parseBoolean(get(ENV.AUTO_START_DAEMON, 'true'), true),
    useGeminiCliSessions: parseBoolean(get(ENV.USE_GEMINI_CLI_SESSIONS, 'true'), true),
    geminiSessionBindingScope: parseGeminiSessionBindingScope(get(ENV.GEMINI_SESSION_BINDING_SCOPE, 'channel')),
    cliIdleTimeoutMs: parseInt(get(ENV.CLI_IDLE_TIMEOUT_MS, '300000'), 10),
    setupValidationPending: parseBoolean(
      get(ENV.SETUP_VALIDATION_PENDING, hasInstallSettings ? 'true' : 'false'),
      false,
    ),
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
  if (!fs.existsSync(envPath)) {
    persistConfigEnvUpdates(extensionDir, { [ENV.GEMINI_MODEL]: model });
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  let found = false;

  const newLines = lines.map((line) => {
    if (line.trim().startsWith(`${ENV.GEMINI_MODEL}=`)) {
      found = true;
      return `${ENV.GEMINI_MODEL}=${model}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${ENV.GEMINI_MODEL}=${model}`);
  }

  fs.writeFileSync(envPath, newLines.join('\n'));
}

export function persistConfigEnvUpdates(
  extensionDir: string,
  updates: Partial<Record<ConfigEnvKey, string>>,
): void {
  const runtimePaths = ensureRuntimePaths(extensionDir);
  updateManagedConfigFile(runtimePaths.managedConfigFile, (current) => {
    const nextEnv = normalizeConfigMap({
      ...current.env,
      ...updates,
    });
    return {
      ...current,
      env: nextEnv,
    };
  });
}

export function persistDiscordMetadata(
  extensionDir: string,
  updates: ManagedDiscordMetadata,
): void {
  const runtimePaths = ensureRuntimePaths(extensionDir);
  updateManagedConfigFile(runtimePaths.managedConfigFile, (current) => ({
    ...current,
    discord: {
      ...current.discord,
      ...filterEmptyMetadata(updates),
    },
  }));
}

function persistManagedConfig(
  filePath: string,
  current: ManagedConfigFile,
  values: Record<string, string>,
): void {
  updateManagedConfigFile(filePath, () => ({
    ...current,
    env: normalizeConfigMap(values),
  }));
}

function filterEmptyMetadata(updates: ManagedDiscordMetadata): ManagedDiscordMetadata {
  const next: ManagedDiscordMetadata = {};
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'string' && value.trim()) {
      next[key as keyof ManagedDiscordMetadata] = value;
    }
  }
  return next;
}
