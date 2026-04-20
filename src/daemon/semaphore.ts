/**
 * Semaphore — bounded concurrency gate for Gemini CLI subprocess spawns.
 * Prevents CPU saturation and thermal throttling by limiting parallel calls.
 */

export class Semaphore {
  private readonly queue: (() => void)[] = [];
  private active = 0;

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error(`Semaphore maxConcurrent must be >= 1, got ${maxConcurrent}`);
    }
  }

  /**
   * Acquire a slot with a timeout for feedback.
   * If the slot isn't acquired within `timeoutMs`, `onTimeout` is called once.
   */
  async acquireWithTimeout(timeoutMs: number, onTimeout: () => void): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    let timeoutHandled = false;
    const timeout = setTimeout(() => {
      timeoutHandled = true;
      onTimeout();
    }, timeoutMs);

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        if (!timeoutHandled) {
          clearTimeout(timeout);
        }
        this.active++;
        resolve();
      });
    });
  }

  /**
   * Release a slot. Wakes the next queued caller if any.
   */
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /** Number of currently active slots. */
  get inFlight(): number {
    return this.active;
  }

  /** Number of callers waiting for a slot. */
  get waiting(): number {
    return this.queue.length;
  }
}
