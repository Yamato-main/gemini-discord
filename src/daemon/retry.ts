/**
 * Discord API rate limit retry wrapper.
 * Applied to every channel.send(), message.edit(), channel.sendTyping().
 */

import { log } from './log.js';

/**
 * Retry a function on Discord 429 rate limit errors.
 * Respects the retryAfter field from Discord's response.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit = isRateLimitError(err);

      if (!isRateLimit || attempt === maxAttempts) {
        throw err;
      }

      const retryAfter = getRetryAfter(err, baseDelayMs, attempt);
      log.warn('Rate limited by Discord', { retryAfter, attempt, maxAttempts });
      await sleep(retryAfter);
    }
  }

  // TypeScript: unreachable, but satisfies the return type
  throw new Error('withRetry: unreachable');
}

function isRateLimitError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return e['status'] === 429 || e['httpStatus'] === 429 || e['code'] === 429;
}

function getRetryAfter(err: unknown, baseDelayMs: number, attempt: number): number {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e['retryAfter'] === 'number') {
      return e['retryAfter'] * 1000;
    }
  }
  // Exponential backoff fallback
  return baseDelayMs * 2 ** (attempt - 1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
