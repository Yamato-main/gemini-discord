import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Client } from 'discord.js';
import type { Config, DmPairingSnapshot } from '../shared/types.js';
import { log } from './log.js';

interface StoredDmPairing {
  userId: string;
  channelId: string;
  pairedAt: string;
  lastSeenAt: string;
}

interface DmPairingFile {
  version: 1;
  pairings: StoredDmPairing[];
}

function pairingsPath(extensionDir: string): string {
  return path.join(extensionDir, '.gemini-discord', 'dm-pairings.json');
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadPairingMap(extensionDir: string): Map<string, StoredDmPairing> {
  const filePath = pairingsPath(extensionDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<DmPairingFile>;
    const pairings = Array.isArray(parsed.pairings) ? parsed.pairings : [];
    return new Map(
      pairings
        .filter((entry): entry is StoredDmPairing => Boolean(entry && typeof entry.userId === 'string' && typeof entry.channelId === 'string'))
        .map((entry) => [entry.userId, entry]),
    );
  } catch {
    return new Map();
  }
}

function savePairingMap(extensionDir: string, pairings: Map<string, StoredDmPairing>): void {
  const filePath = pairingsPath(extensionDir);
  ensureParentDir(filePath);
  const payload: DmPairingFile = {
    version: 1,
    pairings: [...pairings.values()].sort((left, right) => left.userId.localeCompare(right.userId)),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function resolveDmPairingKey(userId: string): string {
  return `dm:${userId}`;
}

export function touchDmPairing(extensionDir: string, userId: string, channelId: string): StoredDmPairing {
  const pairings = loadPairingMap(extensionDir);
  const now = new Date().toISOString();
  const existing = pairings.get(userId);
  const next: StoredDmPairing = {
    userId,
    channelId,
    pairedAt: existing?.pairedAt ?? now,
    lastSeenAt: now,
  };
  pairings.set(userId, next);
  savePairingMap(extensionDir, pairings);
  return next;
}

export function listDmPairings(extensionDir: string): DmPairingSnapshot[] {
  return [...loadPairingMap(extensionDir).values()]
    .sort((left, right) => left.userId.localeCompare(right.userId))
    .map((entry) => ({
      userId: entry.userId,
      channelId: entry.channelId,
      pairedAt: entry.pairedAt,
      lastSeenAt: entry.lastSeenAt,
    }));
}

export async function ensureOwnerDmPairings(client: Client, config: Config, extensionDir: string): Promise<void> {
  if (!config.enableDMs) {
    return;
  }

  const userIds = [...new Set([...config.ownerIds, ...config.allowedUserIds])];
  for (const userId of userIds) {
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const pairing = touchDmPairing(extensionDir, userId, dm.id);
      log.info('DM pairing ready', pairing);
    } catch (error) {
      log.warn('Failed to bootstrap DM pairing', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
