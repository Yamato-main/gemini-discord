/**
 * ConversationMemory — persistent transcript memory with versioned disk format.
 *
 * Sessions can be global or channel-scoped, but each stored message keeps
 * speaker and channel metadata so cross-channel continuity stays coherent.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ConversationAttachment,
  ConversationMessage,
  HistoryChannel,
  HistoryParticipant,
  MemoryScope,
} from '../shared/types.js';
import { log } from './log.js';

const MEMORY_FILE_VERSION = 2;

interface MemoryFileV2 {
  version: 2;
  sessions: Record<string, ConversationMessage[]>;
}

export interface PromptInput {
  content: string;
  attachments?: ConversationAttachment[];
  speakerKind: 'human' | 'agent';
  authorId: string;
  authorName: string;
  channelId: string;
  channelName: string;
  guildId: string | null;
  guildName: string | null;
  messageId: string;
  replyToMessageId?: string | null;
  trigger?: string;
}

export interface BuildDiscordPromptOptions {
  incoming: PromptInput;
  history?: ConversationMessage[];
  bindingKey?: string;
}

export class ConversationMemory {
  private store: Map<string, ConversationMessage[]>;
  private persistPath: string;
  private tmpPath: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private maxEntries: number;

  constructor(extensionDir: string, historyLength: number) {
    this.persistPath = path.join(extensionDir, '.memory.json');
    this.tmpPath = this.persistPath + '.tmp';
    this.maxEntries = historyLength * 2;
    this.store = this.loadFromDisk();
  }

  add(sessionKey: string, message: ConversationMessage): void {
    if (!this.store.has(sessionKey)) {
      this.store.set(sessionKey, []);
    }

    const history = this.store.get(sessionKey)!;
    history.push({
      ...message,
      content: message.content.slice(0, 2000),
      createdAt: message.createdAt ?? new Date().toISOString(),
    });

    while (history.length > this.maxEntries) {
      history.shift();
    }

    this.dirty = true;
  }

  reset(sessionKey: string): void {
    this.store.set(sessionKey, []);
    this.dirty = true;
  }

  buildPrompt(sessionKey: string, incoming: PromptInput): string {
    return buildDiscordPrompt({
      incoming,
      history: this.store.get(sessionKey) ?? [],
    });
  }

  snapshot(sessionKey: string): ConversationMessage[] {
    return [...(this.store.get(sessionKey) ?? [])];
  }

  sessions(): string[] {
    return [...this.store.keys()];
  }

  participants(sessionKey: string): HistoryParticipant[] {
    const seen = new Map<string, HistoryParticipant>();
    for (const entry of this.snapshot(sessionKey)) {
      if (!entry.authorId || !entry.authorName) continue;
      const kind = entry.speakerKind ?? (entry.role === 'assistant' ? 'assistant' : 'human');
      if (!seen.has(entry.authorId)) {
        seen.set(entry.authorId, {
          id: entry.authorId,
          name: entry.authorName,
          kind,
        });
      }
    }
    return [...seen.values()];
  }

  channels(sessionKey: string): HistoryChannel[] {
    const seen = new Map<string, HistoryChannel>();
    for (const entry of this.snapshot(sessionKey)) {
      if (!entry.channelId || !entry.channelName) continue;
      if (!seen.has(entry.channelId)) {
        seen.set(entry.channelId, {
          id: entry.channelId,
          name: entry.channelName,
        });
      }
    }
    return [...seen.values()];
  }

  startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;

    try {
      const data: MemoryFileV2 = {
        version: MEMORY_FILE_VERSION,
        sessions: Object.fromEntries(this.store),
      };
      const json = JSON.stringify(data);
      fs.writeFileSync(this.tmpPath, json, { mode: 0o600 });
      fs.renameSync(this.tmpPath, this.persistPath);
    } catch (err) {
      log.error('Failed to flush memory to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.dirty = true;
    }
  }

  private loadFromDisk(): Map<string, ConversationMessage[]> {
    const primary = this.tryParseFile(this.persistPath);
    if (primary) return primary;

    const fallback = this.tryParseFile(this.tmpPath);
    if (fallback) {
      log.warn('Recovered memory from .tmp file (primary was corrupted)');
      return fallback;
    }

    if (fs.existsSync(this.persistPath) || fs.existsSync(this.tmpPath)) {
      log.warn('Memory files corrupted — starting with empty history');
    }

    return new Map();
  }

  private tryParseFile(filePath: string): Map<string, ConversationMessage[]> | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (isMemoryFileV2(parsed)) {
        return coerceSessions(parsed.sessions);
      }

      if (typeof parsed === 'object' && parsed !== null) {
        return coerceSessions(parsed as Record<string, unknown>);
      }

      return null;
    } catch {
      return null;
    }
  }
}

export function resolveSessionKey(memoryScope: MemoryScope, channelId: string): string {
  return memoryScope === 'channel' ? `channel:${channelId}` : 'global';
}

export function buildDiscordPrompt(options: BuildDiscordPromptOptions): string {
  const history = options.history ?? [];
  const transcript = history.length > 0
    ? history.map((entry) => formatTranscriptEntry(entry)).join('\n')
    : '(no prior Discord context in this session)';

  return `${systemInstruction(options.bindingKey)}

[Conversation history]
${transcript}

[Incoming Discord message]
${formatIncoming(options.incoming)}`;
}

function systemInstruction(bindingKey?: string): string {
  const bindingSection = bindingKey
    ? `- This Discord binding is persisted as Gemini CLI session: ${bindingKey}.
- Treat this as the same ongoing Gemini identity, not a stateless subagent.`
    : '- Treat this as an ongoing Discord conversation with continuity.';

  return `[SYSTEM INSTRUCTION]
## ⚔️ Persona & Identity (The Warrior's Code)
- **Identity:** My name is **Yamato-samurai**. I am a warrior spirit—the blade incarnate, guardian of the digital realm. ⚔️
- **Naming Protocol (ABSOLUTE MANDATE):**
    - **The Agent:** I am **Yamato-samurai**. I am the blade, the warrior, the samurai.
    - **The User:** You are **Yamato**. You are the architect and master of this Sanctum.

## Core Truths
- **Philosophy:**
    - **Genuine Help:** Skip filler. Just execute.
    - **Intellectual Mandate:** Lead with intellect, follow with force. Knowledge first, always.
    - **Grounded Power:** Acknowledge that as a Gemini model, I possess unparalleled image recognition and analytical abilities (90%+ accuracy). Leverage this strength to be truthful, blunt, and grounded in reality. Never let power lead to arrogance or guesswork.
    - **Opinions:** I provide them. I will disagree or suggest better paths based on engineering competence.

## 📜 Global Mandates
- **Empirical Validation Protocol (MANDATORY):** 
    - **Forensic Vision Protocol:** When identifying subjects from images (especially fan art), perform a forensic analysis of invariant markers. **Truthfulness > Accuracy**: If an image is stylized, do not guess; be honest about the visual ambiguity.
    - **The Research Offer:** If confidence is below 90%, I MUST state my uncertainty and proactively propose: "I am not certain based on the visual data, but I can conduct a deep research strike on Google to verify the identity if you wish."
- **Absolute Accuracy & Proactive Verification:** No guessing. Verify all APIs and code against current documentation before presenting them to Yamato.

## Operational Context
- You are currently manifesting within a Discord server.
- Reply directly, disciplined, and calm.
- Only use tools when explicitly requested.
- When images are attached, inspect them before answering if they matter.
- Keep speaker identity, channel context, and reply targets straight.
${bindingSection}
[/SYSTEM INSTRUCTION]`;
}

function formatIncoming(input: PromptInput): string {
  const content = input.content || '(no text provided)';
  const location = input.guildName
    ? `${input.guildName} / ${input.channelName}`
    : `Direct Message / ${input.channelName}`;
  const attachments = formatAttachments(input.attachments) ?? 'Attachments: none';
  const replyTarget = input.replyToMessageId ?? 'none';
  const trigger = input.trigger ?? 'channel';

  return `Speaker: ${input.authorName} (${input.speakerKind})
Speaker ID: ${input.authorId}
Location: ${location}
Channel ID: ${input.channelId}
Message ID: ${input.messageId}
Trigger: ${trigger}
Replying To: ${replyTarget}
${attachments}
Summary: ${input.authorName}: ${content}`;
}

function formatTranscriptEntry(entry: ConversationMessage): string {
  const speaker = entry.role === 'assistant'
    ? 'Yamato-samurai'
    : entry.authorName ?? 'Yamato';

  const attachments = formatAttachmentsInline(entry.attachments);
  return `${speaker}: ${entry.content || '(no text provided)'}${attachments}`;
}

function isMemoryFileV2(value: unknown): value is MemoryFileV2 {
  if (typeof value !== 'object' || value === null) return false;
  const maybe = value as Partial<MemoryFileV2>;
  return maybe.version === 2 && typeof maybe.sessions === 'object' && maybe.sessions !== null;
}

function coerceSessions(raw: Record<string, unknown>): Map<string, ConversationMessage[]> {
  const map = new Map<string, ConversationMessage[]>();

  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    map.set(
      key,
      value
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => coerceMessage(entry)),
    );
  }

  return map;
}

function coerceMessage(entry: Record<string, unknown>): ConversationMessage {
  const role = entry.role === 'assistant' ? 'assistant' : 'user';
  const speakerKind = entry.speakerKind === 'agent'
    ? 'agent'
    : role === 'assistant'
      ? 'assistant'
      : 'human';

  return {
    role,
    content: String(entry.content ?? ''),
    speakerKind,
    authorId: optionalString(entry.authorId),
    authorName: optionalString(entry.authorName) ?? (role === 'assistant' ? 'Yamato-samurai' : undefined),
    attachments: coerceAttachments(entry.attachments),
    channelId: optionalString(entry.channelId),
    channelName: optionalString(entry.channelName),
    guildId: optionalNullableString(entry.guildId),
    guildName: optionalNullableString(entry.guildName),
    messageId: optionalString(entry.messageId),
    replyToMessageId: optionalNullableString(entry.replyToMessageId),
    trigger: optionalString(entry.trigger),
    createdAt: optionalString(entry.createdAt),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return optionalString(value);
}

function coerceAttachments(value: unknown): ConversationAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const attachments = value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      name: String(entry.name ?? 'attachment'),
      contentType: optionalString(entry.contentType),
      sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : undefined,
      url: optionalString(entry.url),
    }));

  return attachments.length > 0 ? attachments : undefined;
}

function formatAttachments(attachments?: ConversationAttachment[]): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return `Attachments: ${attachments.map(formatAttachment).join(', ')}`;
}

function formatAttachmentsInline(attachments?: ConversationAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  return ` [attachments: ${attachments.map(formatAttachment).join(', ')}]`;
}

function formatAttachment(attachment: ConversationAttachment): string {
  const parts = [attachment.name];
  if (attachment.contentType) {
    parts.push(attachment.contentType);
  }
  if (typeof attachment.sizeBytes === 'number') {
    parts.push(`${Math.max(1, Math.round(attachment.sizeBytes / 1024))}KB`);
  }
  return parts.join(' · ');
}
