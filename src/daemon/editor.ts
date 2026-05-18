/**
 * LiveEditor — streaming Discord message edits with bounded display buffer.
 *
 * Uses a sliding window for display (~1900 chars) while the full response
 * is accumulated separately in gemini.ts. Uses native Discord typing indicator
 * before the first message chunk is sent.
 *
 * Tuned for responsiveness:
 * - 1000ms edit interval (at Discord's 5/5s rate limit boundary with retry backoff)
 * - Adaptive first-message: sends as soon as a short phrase is buffered
 */

import type { Message, TextChannel, DMChannel, NewsChannel } from 'discord.js';
import { withRetry, retrySend } from './retry.js';

import { sanitizeStreamChunk } from './sanitizer.js';

const STREAM_EDIT_INTERVAL = 1000; // Fastest steady pacing that respects Discord's 5 edits / 5s rate limit
const DISPLAY_CAP = 1900;
const FIRST_MESSAGE_THRESHOLD = 12; // Small enough to feel immediate without flashing single-token fragments

export interface LiveEditorOptions {
  placeholderDelayMs?: number | null;
  placeholderText?: string;
}

export interface FinalizeOptions {
  allowEmpty?: boolean;
  rawText?: string;
}

/** Concrete sendable channel — bots never encounter PartialGroupDMChannel. */
type SendableChannel = TextChannel | DMChannel | NewsChannel;

export class LiveEditor {
  private channel: SendableChannel | null = null;
  private message: Message | null = null;
  private sentMessageIds: string[] = [];
  private displayBuf = '';
  private lastEditAt = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private placeholderTimer: ReturnType<typeof setTimeout> | null = null;
  private editInFlight: Promise<void> | null = null;
  private finished = false;
  private lastSentContent = '';
  private readonly placeholderDelayMs: number | null;
  private readonly placeholderText: string;

  constructor(options: LiveEditorOptions = {}) {
    this.placeholderDelayMs = options.placeholderDelayMs === undefined ? 4000 : options.placeholderDelayMs;
    this.placeholderText = options.placeholderText ?? '⚔️ Thinking…';
  }

  /**
   * Start the native Discord typing indicator.
   */
  async init(channel: SendableChannel): Promise<void> {
    this.channel = channel;
    await retrySend(() => this.channel!.sendTyping()).catch(() => {});

    if (this.placeholderDelayMs !== null) {
      this.placeholderTimer = setTimeout(() => {
        this.placeholderTimer = null;
        if (!this.message && !this.finished && !this.editInFlight) {
          this.sendPlaceholder();
        }
      }, this.placeholderDelayMs);
    }
    
    // Keep it active every 9 seconds until we send the first real message or finish
    this.typingInterval = setInterval(() => {
      if (!this.message && !this.finished) {
        retrySend(() => this.channel!.sendTyping()).catch(() => {});
      }
    }, 9000);
  }

  /**
   * Feed a token into the display buffer (sliding window).
   * The full response is accumulated by the caller (gemini.ts).
   *
   * Adaptive: sends the first message as soon as we have enough chars
   * to eliminate the dead zone between typing indicator and first visible response.
   */
  feed(token: string): void {
    this.displayBuf += token;
    if (this.displayBuf.length > DISPLAY_CAP) {
      this.displayBuf = this.displayBuf.slice(-DISPLAY_CAP);
    }

    // Adaptive first-message: send immediately once we cross the threshold
    if (!this.message && !this.editInFlight && this.displayBuf.length >= FIRST_MESSAGE_THRESHOLD) {
      this.doEdit();
      return;
    }

    this.scheduleEdit();
  }

  /**
   * Feed an indicator that the model is thinking or calling tools.
   */
  feedThought(): void {
    // No-op. The native typing indicator is sufficient.
  }

  /**
   * Finalize with the complete response text.
   * Sends or updates the message with the full response (chunked if needed).
   */
  async finalize(
    fullText: string,
    chunkFn: (text: string) => string[],
    options: FinalizeOptions = {},
  ): Promise<string[]> {
    this.finished = true;
    this.clearTimers();

    // Wait for any in-flight edit/send to complete
    if (this.editInFlight) {
      await this.editInFlight;
    }

    const sanitizedText = fullText.trim();

    if (!sanitizedText) {
      if (options.allowEmpty) {
        if (this.message) {
          await retrySend(() => this.message!.delete()).catch(() => {});
        }
        return [];
      }

      // If the LLM actually sent text but our pipeline erased it all,
      // show a fallback so the user isn't stuck with an error.
      if (options.rawText?.trim()) {
        const fallback = `*(The response contained only metadata or internal thinking blocks)*\n\n**Raw Output Preview:**\n> ${options.rawText.slice(0, 300).replace(/\n/g, '\n> ')}...`;
        const chunks = chunkFn(fallback);
        return this.sendChunks(chunks);
      }

      await this.sendError('⚠️ Gemini returned an empty response. Try rephrasing.');
      return [];
    }

    const chunks = chunkFn(sanitizedText);
    return this.sendChunks(chunks);
  }

  private async sendChunks(chunks: string[]): Promise<string[]> {
    if (this.message) {
      await retrySend(() => this.message!.edit(chunks[0]));
      this.sentMessageIds = [this.message.id];
      for (const chunk of chunks.slice(1)) {
        const sent = await retrySend(() => this.channel!.send(chunk));
        this.sentMessageIds.push(sent.id);
      }
    } else {
      // If we never even created the first message, send it now
      for (const chunk of chunks) {
        const sent = await retrySend(() => this.channel!.send(chunk));
        this.sentMessageIds.push(sent.id);
      }
    }

    return [...this.sentMessageIds];
  }


  /**
   * Display an error message.
   */
  async sendError(text: string): Promise<void> {
    this.finished = true;
    this.clearTimers();

    if (this.editInFlight) {
      await this.editInFlight;
    }

    if (this.message) {
      await retrySend(() => this.message!.edit(text));
    } else if (this.channel) {
      await retrySend(() => this.channel!.send(text));
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private scheduleEdit(): void {
    if (this.editTimer || this.finished) return;

    const elapsed = Date.now() - this.lastEditAt;
    const wait = Math.max(0, STREAM_EDIT_INTERVAL - elapsed);

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.doEdit();
    }, wait);
  }

  private doEdit(): void {
    if (this.finished || !this.channel || this.editInFlight) return;
    if (!this.message && this.displayBuf.length === 0) return;

    // Use a clean cursor indicator.
    const indicator = ' ▌';

    const baseContent = (this.displayBuf + indicator).slice(0, 1990);
    const content = sanitizeStreamChunk(baseContent).trim();

    if (content === this.lastSentContent) return;
    this.lastSentContent = content;

    if (!this.message) {
      // First time sending text — stop typing indicator, create the message
      this.clearTypingInterval();
      this.clearPlaceholderTimer();
      this.editInFlight = retrySend(() => this.channel!.send(content))
        .then((msg) => {
          this.message = msg;
          this.lastEditAt = Date.now();
        })
        .catch(() => {})
        .finally(() => {
          this.editInFlight = null;
          this.scheduleEdit(); // Schedule again if buf changed during flight
        });
    } else {
      // Subsequent updates, edit the existing message
      this.editInFlight = retrySend(() => this.message!.edit(content))
        .then(() => {
          this.lastEditAt = Date.now();
        })
        .catch(() => {})
        .finally(() => {
          this.editInFlight = null;
          this.scheduleEdit(); // Schedule again if buf changed during flight
        });
    }
  }

  private sendPlaceholder(): void {
    if (!this.channel || this.message || this.finished || this.editInFlight) return;

    this.clearTypingInterval();
    this.lastSentContent = this.placeholderText;
    this.editInFlight = retrySend(() => this.channel!.send(this.placeholderText))
      .then((msg) => {
        this.message = msg;
        this.lastEditAt = Date.now();
      })
      .catch(() => {})
      .finally(() => {
        this.editInFlight = null;
        if (this.displayBuf.length > 0) {
          this.scheduleEdit();
        }
      });
  }

  private clearTypingInterval(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  private clearPlaceholderTimer(): void {
    if (this.placeholderTimer) {
      clearTimeout(this.placeholderTimer);
      this.placeholderTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    this.clearPlaceholderTimer();
    this.clearTypingInterval();
  }
}
