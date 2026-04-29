import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GeminiSessionBindingScope } from '../shared/types.js';
import { ensureRuntimePaths, resolveRuntimePaths } from '../shared/runtime-paths.js';
import { resolveDmPairingKey } from './dm-pairing.js';

export interface GeminiBindingContext {
  guildId: string | null;
  channelId: string;
  dmUserId?: string | null;
}

export interface GeminiBindingWorkspace {
  bindingKey: string;
  bindingDir: string;
  attachmentsDir: string;
}

export interface GeminiBindingState {
  hasSession: boolean;
  lastSessionId?: string;
  archivedSessionIds?: string[];
  lastResetAt?: string;
}

export interface GeminiBindingSnapshot {
  workspace: string;
  hasSession: boolean;
  lastSessionId?: string;
  archivedSessions: number;
  lastResetAt?: string;
}

export function resolveGeminiBindingKey(
  scope: GeminiSessionBindingScope,
  context: GeminiBindingContext,
): string {
  switch (scope) {
    case 'global':
      return 'global';
    case 'server':
      if (!context.guildId && context.dmUserId) {
        return resolveDmPairingKey(context.dmUserId);
      }
      return context.guildId ? `guild:${context.guildId}` : `channel:${context.channelId}`;
    case 'channel':
    default:
      if (!context.guildId && context.dmUserId) {
        return resolveDmPairingKey(context.dmUserId);
      }
      return `channel:${context.channelId}`;
  }
}

export function ensureGeminiBindingWorkspace(
  extensionDir: string,
  bindingKey: string,
): GeminiBindingWorkspace {
  const bindingsRoot = ensureRuntimePaths(extensionDir).bindingsDir;
  const bindingDir = resolveBindingWorkspacePath(bindingsRoot, bindingKey);
  const attachmentsDir = path.join(bindingDir, 'discord-attachments');

  fs.mkdirSync(attachmentsDir, { recursive: true });
  removeLegacyBindingContextFiles(bindingDir);
  syncBindingProjectFile(extensionDir, bindingDir, '.geminiignore');

  return {
    bindingKey,
    bindingDir,
    attachmentsDir,
  };
}

export function loadGeminiBindingState(bindingDir: string): GeminiBindingState {
  const statePath = path.join(bindingDir, '.binding-state.json');

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<GeminiBindingState>;
    const archivedSessionIds = Array.isArray(parsed.archivedSessionIds)
      ? parsed.archivedSessionIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    return {
      hasSession: parsed.hasSession === true,
      lastSessionId: typeof parsed.lastSessionId === 'string' && parsed.lastSessionId
        ? parsed.lastSessionId
        : undefined,
      archivedSessionIds,
      lastResetAt: typeof parsed.lastResetAt === 'string' && parsed.lastResetAt
        ? parsed.lastResetAt
        : undefined,
    };
  } catch {
    return { hasSession: false, archivedSessionIds: [] };
  }
}

export function saveGeminiBindingState(bindingDir: string, state: GeminiBindingState): void {
  const statePath = path.join(bindingDir, '.binding-state.json');
  const nextState: GeminiBindingState = {
    hasSession: state.hasSession,
  };

  if (state.lastSessionId) {
    nextState.lastSessionId = state.lastSessionId;
  }
  if (state.archivedSessionIds && state.archivedSessionIds.length > 0) {
    nextState.archivedSessionIds = [...new Set(state.archivedSessionIds)];
  }
  if (state.lastResetAt) {
    nextState.lastResetAt = state.lastResetAt;
  }

  fs.writeFileSync(statePath, JSON.stringify(nextState), { mode: 0o600 });
}

export function listGeminiBindingStates(extensionDir: string): GeminiBindingSnapshot[] {
  const bindingsRoot = resolveRuntimePaths(extensionDir).bindingsDir;
  if (!fs.existsSync(bindingsRoot)) {
    return [];
  }

  return fs.readdirSync(bindingsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const bindingDir = path.join(bindingsRoot, entry.name);
      const state = loadGeminiBindingState(bindingDir);
      return {
        workspace: entry.name,
        hasSession: state.hasSession,
        lastSessionId: state.lastSessionId,
        archivedSessions: state.archivedSessionIds?.length ?? 0,
        lastResetAt: state.lastResetAt,
      };
    })
    .sort((left, right) => left.workspace.localeCompare(right.workspace));
}

export function cleanupLegacyBindingContextFiles(extensionDir: string): number {
  const bindingsRoot = resolveRuntimePaths(extensionDir).bindingsDir;
  if (!fs.existsSync(bindingsRoot)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(bindingsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    removed += removeLegacyBindingContextFiles(path.join(bindingsRoot, entry.name));
  }
  return removed;
}

export function recordGeminiBindingSession(bindingDir: string, sessionId: string | undefined): GeminiBindingState {
  const current = loadGeminiBindingState(bindingDir);
  const lastSessionId = sessionId ?? current.lastSessionId;
  const nextState: GeminiBindingState = {
    hasSession: Boolean(lastSessionId),
    lastSessionId,
    archivedSessionIds: current.archivedSessionIds ?? [],
    lastResetAt: current.lastResetAt,
  };
  saveGeminiBindingState(bindingDir, nextState);
  return nextState;
}

function removeLegacyBindingContextFiles(bindingDir: string): number {
  let removed = 0;
  for (const fileName of ['GEMINI.md', 'Gemini.md', 'gemini.md']) {
    const target = path.join(bindingDir, fileName);
    if (!fs.existsSync(target)) {
      continue;
    }

    try {
      fs.rmSync(target, { force: true });
      removed += 1;
    } catch {
      // Best-effort migration for old binding workspaces.
    }
  }
  return removed;
}

export function resetGeminiBindingSession(bindingDir: string): GeminiBindingState {
  const current = loadGeminiBindingState(bindingDir);
  const archivedSessionIds = [
    ...(current.lastSessionId ? [current.lastSessionId] : []),
    ...(current.archivedSessionIds ?? []),
  ];
  const nextState: GeminiBindingState = {
    hasSession: false,
    archivedSessionIds: [...new Set(archivedSessionIds)].slice(0, 20),
    lastResetAt: new Date().toISOString(),
  };
  saveGeminiBindingState(bindingDir, nextState);
  return nextState;
}

function syncBindingProjectFile(extensionDir: string, bindingDir: string, fileName: string): void {
  const source = path.join(extensionDir, fileName);
  if (!fs.existsSync(source)) {
    return;
  }

  const target = path.join(bindingDir, fileName);
  const sourceMtime = fs.statSync(source).mtimeMs;
  const targetMtime = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;

  if (!fs.existsSync(target) || sourceMtime > targetMtime) {
    fs.copyFileSync(source, target);
  }
}

function toBindingSlug(bindingKey: string): string {
  return bindingKey
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveBindingWorkspacePath(bindingsRoot: string, bindingKey: string): string {
  const legacyDir = path.join(bindingsRoot, bindingKey);
  const slugDir = path.join(bindingsRoot, toBindingSlug(bindingKey));

  if (fs.existsSync(slugDir)) {
    return slugDir;
  }

  if (!fs.existsSync(legacyDir)) {
    return slugDir;
  }

  try {
    fs.mkdirSync(bindingsRoot, { recursive: true });
    fs.renameSync(legacyDir, slugDir);
    return slugDir;
  } catch {
    return legacyDir;
  }
}
