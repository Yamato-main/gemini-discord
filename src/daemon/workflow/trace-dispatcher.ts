import type { TextChannel, ThreadChannel, Message } from 'discord.js';
import type { TraceEvent } from './trace-event.js';
import { TraceRendererRegistry } from './trace-renderer.js';
import type { ThreadManifest } from './thread-manifest.js';
import { log } from '../log.js';
import { SUPPRESS_DISCORD_MENTIONS } from '../mention-safety.js';

export class TraceDispatcher {
  private activeMessages = new Map<string, Message>();
  private headerMessage: Message | null = null;
  private startedAt = Date.now();
  private toolCallCount = 0;
  private currentStep: string | null = null;
  private seenToolCallIds = new Set<string>();
  private hasTraceEvents = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private threadChannel: ThreadChannel | TextChannel,
    private registry: TraceRendererRegistry,
  ) {}

  async dispatch(event: TraceEvent): Promise<void> {
    try {
      const rendered = this.registry.render(event);
      if (rendered.suppressed) {
        this.hasTraceEvents = true;
        if (event.displayName || event.toolName) {
          this.currentStep = event.displayName || event.toolName;
        }
        await this.updateRunHeader('running');
        return;
      }

      const payload = {
        content: rendered.content,
        embeds: rendered.embeds,
        files: rendered.files,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      };

      this.hasTraceEvents = true;
      const toolCallId = resolveToolCallId(event);
      if (toolCallId ? !this.seenToolCallIds.has(toolCallId) : event.type === 'tool_started') {
        this.toolCallCount += 1;
        if (toolCallId) {
          this.seenToolCallIds.add(toolCallId);
        }
      }
      if (event.displayName || event.toolName) {
        this.currentStep = event.displayName || event.toolName;
      }
      await this.updateRunHeader('running');

      if (toolCallId) {
        const existingMessage = this.activeMessages.get(toolCallId);
        
        if (existingMessage) {
          if (event.status === 'progress') {
            await existingMessage.edit(payload);
            return;
          } else if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            await existingMessage.edit(payload);
            this.activeMessages.delete(toolCallId);
            return;
          }
        }
      }

      const sent = await this.threadChannel.send(payload);
      
      if (toolCallId && (event.status === 'started' || event.status === 'progress')) {
        this.activeMessages.set(toolCallId, sent);
      }
    } catch (error) {
      log.warn('Failed to dispatch trace event to Discord', { error: String(error) });
    }
  }

  async dispatchRunHeader(manifest: ThreadManifest): Promise<void> {
    try {
      this.startedAt = Date.now();
      this.toolCallCount = 0;
      this.currentStep = null;
      this.seenToolCallIds.clear();
      this.hasTraceEvents = false;
      this.headerMessage = await this.threadChannel.send({
        content: `◌ **Queued** · ${this.formatTask(manifest.taskSummary)}`,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
      this.startHeartbeat();
      await this.updateRunHeader('running');
    } catch (error) {
      log.warn('Failed to dispatch run header', { error: String(error) });
    }
  }

  async dispatchRunComplete(): Promise<void> {
    this.stopHeartbeat();
    await this.updateRunHeader('complete');
  }

  async dispatchRunFailed(error: unknown): Promise<void> {
    this.stopHeartbeat();
    const message = error instanceof Error ? error.message : String(error);
    await this.updateRunHeader('failed', message);
  }

  async dispatchFinalResponse(response: string): Promise<void> {
    try {
      await this.threadChannel.send({
        content: response,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
    } catch (error) {
      log.warn('Failed to dispatch final response', { error: String(error) });
    }
  }

  private async updateRunHeader(state: 'running' | 'complete' | 'failed', detail?: string): Promise<void> {
    if (!this.headerMessage) return;

    const elapsed = this.formatElapsed(Date.now() - this.startedAt);
    let content: string;
    if (state === 'complete') {
      content = `✓ **Complete** \`${elapsed}\` · \`${this.toolCallCount}\` tool calls`;
    } else if (state === 'failed') {
      const suffix = detail ? ` · ${detail.slice(0, 160)}` : '';
      content = `✗ **Failed** \`${elapsed}\` · \`${this.toolCallCount}\` tool calls${suffix}`;
    } else {
      const suffix = this.currentStep
        ? ` · current step: \`${this.currentStep}\``
        : (this.hasTraceEvents ? '' : ' · waiting for first tool event');
      content = `⌁ **Running** \`${elapsed}\`${suffix}`;
    }

    try {
      await this.headerMessage.edit({
        content,
        allowedMentions: SUPPRESS_DISCORD_MENTIONS,
      });
    } catch (error) {
      log.warn('Failed to update trace run header', { error: String(error) });
    }
  }

  private formatElapsed(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
  }

  private formatTask(task: string): string {
    const trimmed = task.trim().replace(/\s+/g, ' ');
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.updateRunHeader('running').catch(() => {});
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

function resolveToolCallId(event: TraceEvent): string | null {
  if (typeof event.raw?.['toolCallId'] === 'string') {
    return event.raw['toolCallId'];
  }

  const toolCall = event.raw?.toolCall as Record<string, unknown> | undefined;
  return typeof toolCall?.id === 'string' ? toolCall.id : null;
}
