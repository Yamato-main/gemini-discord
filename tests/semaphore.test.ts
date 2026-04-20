import { describe, it, expect, vi } from 'vitest';
import { Semaphore } from '../src/daemon/semaphore.js';

describe('Semaphore', () => {
  it('acquires immediately if slots are available', async () => {
    const sem = new Semaphore(1);
    const start = Date.now();
    await sem.acquireWithTimeout(1000, () => {});
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('triggers onTimeout if slot not acquired within timeout', async () => {
    vi.useFakeTimers();
    const sem = new Semaphore(1);
    await sem.acquireWithTimeout(1000, () => {}); // Occupy the only slot

    let timeoutCalled = false;
    const p = sem.acquireWithTimeout(500, () => {
      timeoutCalled = true;
    });

    await vi.advanceTimersByTimeAsync(600);
    expect(timeoutCalled).toBe(true);

    sem.release();
    await p;
    vi.useRealTimers();
  });

  it('does NOT trigger onTimeout if slot acquired before timeout', async () => {
    vi.useFakeTimers();
    const sem = new Semaphore(1);
    await sem.acquireWithTimeout(1000, () => {}); // Occupy the only slot

    let timeoutCalled = false;
    const p = sem.acquireWithTimeout(500, () => {
      timeoutCalled = true;
    });

    sem.release();
    await p;
    
    await vi.advanceTimersByTimeAsync(600);
    expect(timeoutCalled).toBe(false);
    vi.useRealTimers();
  });

  it('serializes access', async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      await sem.acquireWithTimeout(1000, () => {});
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      sem.release();
    };

    await Promise.all([task(), task(), task()]);
    expect(maxActive).toBe(1);
  });
});
