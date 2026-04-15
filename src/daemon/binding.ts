import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GeminiSessionBindingScope } from '../shared/types.js';

export interface GeminiBindingContext {
  guildId: string | null;
  guildName: string | null;
  channelId: string;
  channelName: string;
  authorId: string;
}

export interface GeminiBindingWorkspace {
  bindingKey: string;
  bindingDir: string;
  attachmentsDir: string;
}

interface BindingState {
  hasSession: boolean;
  lastSessionId?: string;
}

export function resolveGeminiBindingKey(
  scope: GeminiSessionBindingScope,
  context: GeminiBindingContext,
): string {
  if (!context.guildId) {
    return `dm:${context.authorId}`;
  }

  switch (scope) {
    case 'global':
      return 'global';
    case 'channel':
      return `channel:${context.channelId}`;
    case 'server':
    default:
      return `guild:${context.guildId}`;
  }
}

export function ensureGeminiBindingWorkspace(
  extensionDir: string,
  bindingKey: string,
): GeminiBindingWorkspace {
  const safeKey = bindingKey.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const bindingDir = path.join(extensionDir, '.gemini-discord', 'bindings', safeKey);
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

export function loadBindingState(bindingDir: string): BindingState {
  const statePath = path.join(bindingDir, '.binding-state.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BindingState>;
    return {
      hasSession: parsed.hasSession === true,
      lastSessionId: typeof parsed.lastSessionId === 'string' ? parsed.lastSessionId : undefined,
    };
  } catch {
    return { hasSession: false };
  }
}

export function saveBindingState(bindingDir: string, state: BindingState): void {
  const statePath = path.join(bindingDir, '.binding-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
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
