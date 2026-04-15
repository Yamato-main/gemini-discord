import { describe, it, expect } from 'vitest';
import { ChannelQueue } from '../src/daemon/queue.js';

describe('ChannelQueue', () => {
  it('processes tasks in order for a single channel', async () => {
    const queue = new ChannelQueue(10);
    const results: number[] = [];

    queue.enqueue('ch1', async () => {
      await delay(30);
      results.push(1);
    });
    queue.enqueue('ch1', async () => {
      await delay(10);
      results.push(2);
    });
    queue.enqueue('ch1', async () => {
      results.push(3);
    });

    await queue.drainAll();
    expect(results).toEqual([1, 2, 3]);
  });

  it('processes channels concurrently', async () => {
    const queue = new ChannelQueue(10);
    const results: string[] = [];

    queue.enqueue('ch1', async () => {
      await delay(50);
      results.push('ch1');
    });
    queue.enqueue('ch2', async () => {
      await delay(10);
      results.push('ch2');
    });

    await queue.drainAll();
    // ch2 should finish first since it's faster and runs concurrently
    expect(results).toEqual(['ch2', 'ch1']);
  });

  it('serializes tasks that share any queue key', async () => {
    const queue = new ChannelQueue(10);
    const results: string[] = [];

    queue.enqueue(['session:ch1', 'guild:g1'], async () => {
      await delay(40);
      results.push('first');
    });
    queue.enqueue(['session:ch2', 'guild:g1'], async () => {
      results.push('second');
    });

    await queue.drainAll();
    expect(results).toEqual(['first', 'second']);
  });

  it('rejects when queue is full', () => {
    const queue = new ChannelQueue(2);
    const accepted1 = queue.enqueue('ch1', () => delay(1000));
    const accepted2 = queue.enqueue('ch1', () => delay(1000));
    const accepted3 = queue.enqueue('ch1', () => delay(1000));

    expect(accepted1).toBe(true);
    expect(accepted2).toBe(true);
    expect(accepted3).toBe(false);
  });

  it('tracks depth correctly', async () => {
    const queue = new ChannelQueue(10);
    expect(queue.depth('ch1')).toBe(0);

    queue.enqueue('ch1', () => delay(50));
    expect(queue.depth('ch1')).toBe(1);

    queue.enqueue('ch1', () => delay(50));
    expect(queue.depth('ch1')).toBe(2);

    await queue.drainAll();
    expect(queue.depth('ch1')).toBe(0);
  });

  it('does not crash on task errors', async () => {
    const queue = new ChannelQueue(10);
    const results: string[] = [];

    queue.enqueue('ch1', async () => {
      throw new Error('boom');
    });
    queue.enqueue('ch1', async () => {
      results.push('after-error');
    });

    await queue.drainAll();
    // Second task should still execute despite first failing
    expect(results).toEqual(['after-error']);
  });

  it('drainAll resolves when queue is empty', async () => {
    const queue = new ChannelQueue(10);
    await expect(queue.drainAll()).resolves.toBeUndefined();
  });

  it('reclaims tracked tail entries after work completes', async () => {
    const queue = new ChannelQueue(10);

    queue.enqueue(['session:ch1', 'guild:g1'], () => delay(10));
    await queue.drainAll();

    expect((queue as unknown as { tails: Map<string, Promise<void>> }).tails.size).toBe(0);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
