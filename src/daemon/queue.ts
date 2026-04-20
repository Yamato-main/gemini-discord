/**
 * ChannelQueue — async FIFO queue per processing key.
 *
 * A task may depend on one or more shared keys (for example a global memory
 * session plus a guild-bound Gemini session). Tasks that share any key are
 * serialized; disjoint tasks still run concurrently.
 *
 * All in-flight tasks are held in a persistent Set to prevent GC collection
 * of intermediate promises in multi-key chains.
 */

import { log } from './log.js';

export class ChannelQueue {
  private tails: Map<string, Promise<void>> = new Map();
  private depths: Map<string, number> = new Map();
  private readonly activeTasks: Set<Promise<void>> = new Set();
  private maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  /**
   * Enqueue an async function for sequential execution on one or more keys.
   * Returns false if any participating key is already at max depth.
   */
  enqueue(channelId: string | string[], fn: () => Promise<void>): boolean {
    const keys = normalizeKeys(channelId);

    if (keys.some((key) => (this.depths.get(key) ?? 0) >= this.maxDepth)) {
      return false;
    }

    for (const key of keys) {
      this.depths.set(key, (this.depths.get(key) ?? 0) + 1);
    }

    const dependencies = [...new Set(keys.map((key) => this.tails.get(key)).filter(Boolean))] as Promise<void>[];

    const newTail = Promise.allSettled(dependencies)
      .then(() => fn())
      .catch((err) => {
        log.error('Queue task failed', {
          channelId: keys.join(','),
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.activeTasks.delete(newTail);
        this.releaseKeys(keys, newTail);
      });

    // Strong reference prevents GC of intermediate promises in multi-key chains
    this.activeTasks.add(newTail);

    for (const key of keys) {
      this.tails.set(key, newTail);
    }

    return true;
  }

  /**
   * Get the current pending count for one or more keys.
   */
  depth(channelId: string | string[]): number {
    const keys = normalizeKeys(channelId);
    return keys.reduce((maxDepth, key) => Math.max(maxDepth, this.depths.get(key) ?? 0), 0);
  }

  /**
   * Total number of in-flight tasks across all keys.
   */
  get totalInFlight(): number {
    return this.activeTasks.size;
  }

  /**
   * Wait for all in-flight tasks across all channels.
   * Used by graceful shutdown.
   */
  async drainAll(): Promise<void> {
    const tails = [...this.activeTasks];
    await Promise.allSettled(tails);
  }

  private releaseKeys(keys: string[], tail: Promise<void>): void {
    for (const key of keys) {
      const depth = (this.depths.get(key) ?? 1) - 1;
      if (depth <= 0) {
        this.depths.delete(key);
        if (this.tails.get(key) === tail) {
          this.tails.delete(key);
        }
        continue;
      }

      this.depths.set(key, depth);
    }
  }
}

function normalizeKeys(input: string | string[]): string[] {
  const keys = Array.isArray(input) ? input : [input];
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}
