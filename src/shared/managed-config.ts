import * as fs from 'node:fs';
import * as path from 'node:path';

const MANAGED_CONFIG_VERSION = 2;

export interface ManagedDiscordMetadata {
  primaryGuildId?: string;
  primaryGuildName?: string;
  primaryChannelId?: string;
  primaryChannelName?: string;
  botUserId?: string;
  botTag?: string;
  appOwnerId?: string;
  appOwnerTag?: string;
  lastConnectedAt?: string;
}

export interface ManagedConfigFile {
  version: 2;
  updatedAt: string;
  env: Record<string, string>;
  discord: ManagedDiscordMetadata;
}

interface LegacyConfigSnapshotFile {
  version: 1;
  values: Record<string, string>;
}

export function readManagedConfigFile(filePath: string): ManagedConfigFile {
  if (!fs.existsSync(filePath)) {
    return createManagedConfigFile();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ManagedConfigFile | LegacyConfigSnapshotFile>;

    if (parsed.version === 1 && typeof parsed.values === 'object' && parsed.values !== null) {
      return createManagedConfigFile(coerceStringMap(parsed.values));
    }

    if (parsed.version === MANAGED_CONFIG_VERSION) {
      return {
        version: MANAGED_CONFIG_VERSION,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        env: coerceStringMap(parsed.env),
        discord: coerceDiscordMetadata(parsed.discord),
      };
    }
  } catch {
    // Fall back to an empty managed config when the file is unreadable.
  }

  return createManagedConfigFile();
}

export function writeManagedConfigFile(filePath: string, config: ManagedConfigFile): void {
  const payload: ManagedConfigFile = {
    version: MANAGED_CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
    env: coerceStringMap(config.env),
    discord: coerceDiscordMetadata(config.discord),
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function updateManagedConfigFile(
  filePath: string,
  updater: (current: ManagedConfigFile) => ManagedConfigFile,
): ManagedConfigFile {
  const next = updater(readManagedConfigFile(filePath));
  writeManagedConfigFile(filePath, next);
  return next;
}

function createManagedConfigFile(env: Record<string, string> = {}): ManagedConfigFile {
  return {
    version: MANAGED_CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
    env: coerceStringMap(env),
    discord: {},
  };
}

function coerceStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function coerceDiscordMetadata(input: unknown): ManagedDiscordMetadata {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const result: ManagedDiscordMetadata = {};
  const fields: Array<keyof ManagedDiscordMetadata> = [
    'primaryGuildId',
    'primaryGuildName',
    'primaryChannelId',
    'primaryChannelName',
    'botUserId',
    'botTag',
    'appOwnerId',
    'appOwnerTag',
    'lastConnectedAt',
  ];

  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim()) {
      result[field] = value;
    }
  }

  return result;
}
