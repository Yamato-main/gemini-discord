import { describe, it, expect } from 'vitest';
import { withRetry, sleep } from '../src/daemon/retry.js';

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('throws non-rate-limit errors immediately', async () => {
    const err = new Error('not a rate limit');
    await expect(withRetry(() => Promise.reject(err))).rejects.toThrow('not a rate limit');
  });

  it('retries on 429 errors', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return 'success';
    };

    const result = await withRetry(fn, 4, 10); // short delay for test speed
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('throws after max attempts on persistent rate limit', async () => {
    const fn = async () => {
      const err = new Error('rate limited') as Error & { status: number };
      err.status = 429;
      throw err;
    };

    await expect(withRetry(fn, 2, 10)).rejects.toThrow('rate limited');
  });

  it('respects retryAfter field', async () => {
    let attempts = 0;
    const start = Date.now();
    const fn = async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error('limited') as Error & {
          status: number;
          retryAfter: number;
        };
        err.status = 429;
        err.retryAfter = 0.05; // 50ms in seconds
        throw err;
      }
      return 'ok';
    };

    await withRetry(fn, 3, 10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // at least ~50ms wait
  });
});

describe('sleep', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
