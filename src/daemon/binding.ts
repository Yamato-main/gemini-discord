import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GeminiSessionBindingScope } from '../shared/types.js';
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
}

export interface GeminiBindingSnapshot {
  workspace: string;
  hasSession: boolean;
  lastSessionId?: string;
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
  const bindingsRoot = path.join(extensionDir, '.gemini-discord', 'bindings');
  const bindingDir = resolveBindingWorkspacePath(bindingsRoot, bindingKey);
  const attachmentsDir = path.join(bindingDir, 'discord-attachments');

  fs.mkdirSync(attachmentsDir, { recursive: true });
  syncBindingProjectFile(extensionDir, bindingDir, 'GEMINI.md');
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
    return {
      hasSession: parsed.hasSession === true,
      lastSessionId: typeof parsed.lastSessionId === 'string' && parsed.lastSessionId
        ? parsed.lastSessionId
        : undefined,
    };
  } catch {
    return { hasSession: false };
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

  fs.writeFileSync(statePath, JSON.stringify(nextState), { mode: 0o600 });
}

export function listGeminiBindingStates(extensionDir: string): GeminiBindingSnapshot[] {
  const bindingsRoot = path.join(extensionDir, '.gemini-discord', 'bindings');
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
      };
    })
    .sort((left, right) => left.workspace.localeCompare(right.workspace));
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
