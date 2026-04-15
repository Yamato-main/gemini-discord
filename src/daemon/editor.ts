/**
 * LiveEditor — streaming Discord message edits with bounded display buffer.
 *
 * Uses a sliding window for display (~1900 chars) while the full response
 * is accumulated separately in gemini.ts. Uses native Discord typing indicator
 * before the first message chunk is sent.
 */

import type { Message, TextBasedChannel } from 'discord.js';
import { withRetry } from './retry.js';

const STREAM_EDIT_INTERVAL = 2000;
const DISPLAY_CAP = 1900;

export class LiveEditor {
  private channel: TextBasedChannel | null = null;
  private message: Message | null = null;
  private sentMessageIds: string[] = [];
  private displayBuf = '';
  private lastEditAt = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private editInFlight: Promise<void> | null = null;
  private finished = false;

  /**
   * Start the native Discord typing indicator.
   */
  async init(channel: TextBasedChannel): Promise<void> {
    this.channel = channel;
    await withRetry(() => this.channel!.sendTyping()).catch(() => {});
    
    // Keep it active every 9 seconds until we send the first real message or finish
    this.typingInterval = setInterval(() => {
      withRetry(() => this.channel!.sendTyping()).catch(() => {});
    }, 9000);
  }

  /**
   * Feed a token into the display buffer (sliding window).
   * The full response is accumulated by the caller (gemini.ts).
   */
  feed(token: string): void {
    this.displayBuf += token;
    if (this.displayBuf.length > DISPLAY_CAP) {
      this.displayBuf = this.displayBuf.slice(-DISPLAY_CAP);
    }
    this.scheduleEdit();
  }

  /**
   * Finalize with the complete response text.
   * Sends or updates the message with the full response (chunked if needed).
   */
  async finalize(fullText: string, chunkFn: (text: string) => string[]): Promise<string[]> {
    this.finished = true;
    this.clearTimers();

    // Wait for any in-flight edit/send to complete
    if (this.editInFlight) {
      await this.editInFlight;
    }

    if (!fullText.trim()) {
      await this.sendError('⚠️ Gemini returned an empty response. Try rephrasing.');
      return [];
    }

    const chunks = chunkFn(fullText);

    if (this.message) {
      await withRetry(() => this.message!.edit(chunks[0]));
      this.sentMessageIds = [this.message.id];
      const channel = this.message.channel;
      for (const chunk of chunks.slice(1)) {
        const sent = await withRetry(() => channel.send(chunk));
        this.sentMessageIds.push(sent.id);
      }
    } else {
      // If we never even created the first message, send it now
      for (const chunk of chunks) {
        const sent = await withRetry(() => this.channel!.send(chunk));
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
      await withRetry(() => this.message!.edit(text));
    } else if (this.channel) {
      await withRetry(() => this.channel!.send(text));
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
    if (this.finished || !this.channel) return;

    const content = (this.displayBuf + ' ▌').slice(0, 1990);

    if (!this.message) {
      // First time sending text, create the message instead of editing
      this.editInFlight = withRetry(() => this.channel!.send(content))
        .then((msg) => {
          this.message = msg;
          this.lastEditAt = Date.now();
          // Stop the native typing indicator now that a message exists
          if (this.typingInterval) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
          }
        })
        .catch(() => {})
        .finally(() => {
          this.editInFlight = null;
        });
    } else {
      // Subsequent updates, edit the existing message
      this.editInFlight = withRetry(() => this.message!.edit(content))
        .then(() => {
          this.lastEditAt = Date.now();
        })
        .catch(() => {})
        .finally(() => {
          this.editInFlight = null;
        });
    }
  }

  private clearTimers(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }
}
