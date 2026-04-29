import type { Config } from '../shared/types.js';
import type { ConversationMemory } from './memory.js';
import { resolveSessionKey } from './memory.js';
import { ensureGeminiBindingWorkspace, loadGeminiBindingState, resetGeminiBindingSession, resolveGeminiBindingKey } from './binding.js';
import { runtimeStore } from './runtime.js';

export interface SessionResetResult {
  sessionKey: string;
  bindingKey: string;
}

export function resetConversationSession(
  config: Config,
  memory: ConversationMemory,
  extensionDir: string,
  context: { channelId: string; guildId: string | null; authorId?: string | null },
): SessionResetResult {
  const dmUserId = context.guildId ? null : (context.authorId ?? null);
  const sessionKey = resolveSessionKey(config.memoryScope, context.channelId, dmUserId);

  const bindingKey = resolveGeminiBindingKey(config.geminiSessionBindingScope, {
    guildId: context.guildId,
    channelId: context.channelId,
    dmUserId,
  });
  const bindingWorkspace = ensureGeminiBindingWorkspace(extensionDir, bindingKey);
  const bindingState = loadGeminiBindingState(bindingWorkspace.bindingDir);
  memory.archiveAndReset(sessionKey, {
    bindingKey,
    lastSessionId: bindingState.lastSessionId,
  });
  resetGeminiBindingSession(bindingWorkspace.bindingDir);
  runtimeStore.cliPool?.kill(bindingKey);

  return {
    sessionKey,
    bindingKey,
  };
}
