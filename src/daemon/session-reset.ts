import type { Config } from '../shared/types.js';
import type { ConversationMemory } from './memory.js';
import { resolveSessionKey } from './memory.js';
import { ensureGeminiBindingWorkspace, resolveGeminiBindingKey, saveGeminiBindingState } from './binding.js';
import { runtimeStore } from './runtime.js';

export interface SessionResetResult {
  sessionKey: string;
  bindingKey: string;
}

export function resetConversationSession(
  config: Config,
  memory: ConversationMemory,
  extensionDir: string,
  context: { channelId: string; guildId: string | null },
): SessionResetResult {
  const sessionKey = resolveSessionKey(config.memoryScope, context.channelId);
  memory.reset(sessionKey);

  const bindingKey = resolveGeminiBindingKey(config.geminiSessionBindingScope, context);
  const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, bindingKey);
  saveGeminiBindingState(bindingWorkspace.bindingDir, { hasSession: false });
  runtimeStore.cliPool?.kill(bindingKey);

  return {
    sessionKey,
    bindingKey,
  };
}
