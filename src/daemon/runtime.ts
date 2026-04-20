import type { Client } from 'discord.js';
import type { ConversationMemory } from './memory.js';
import type { ChannelQueue } from './queue.js';
import type { Semaphore } from './semaphore.js';
import type { CliProcessPool } from './cli-pool.js';

export interface DaemonRuntime {
  client: Client | null;
  memory: ConversationMemory | null;
  queue: ChannelQueue | null;
  geminiSemaphore: Semaphore | null;
  cliPool: CliProcessPool | null;
  isShuttingDown: boolean;
  agentExchangeCount: Map<string, number>;
}

export const runtimeStore: DaemonRuntime = {
  client: null,
  memory: null,
  queue: null,
  geminiSemaphore: null,
  cliPool: null,
  isShuttingDown: false,
  agentExchangeCount: new Map<string, number>(),
};

export function getRuntime(): DaemonRuntime {
  return runtimeStore;
}
