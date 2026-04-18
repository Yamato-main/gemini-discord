/**
 * ConversationMemory — persistent transcript memory with versioned disk format.
 *
 * Sessions can be global or channel-scoped, but each stored message keeps
 * speaker and channel metadata so cross-channel continuity stays coherent.
 *
 * Eviction:
 * - TTL: sessions untouched for 7 days are evicted.
 * - LRU: if total sessions exceed MAX_SESSIONS, oldest are evicted first.
 * - Sweep runs every 5 minutes alongside the existing 5s flush.
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ConversationAttachment,
  ConversationMessage,
  HistoryChannel,
  HistoryParticipant,
  MemoryScope,
} from '../shared/types.js';
import { log } from './log.js';
import { getChannelMapContext } from './channels.js';

const MEMORY_FILE_VERSION = 2;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS = 500;
const EVICTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PROMPT_HISTORY_MESSAGE_LIMIT = 16;
const DEFAULT_PROMPT_HISTORY_CHAR_BUDGET = 12_000;
const TRANSCRIPT_ENTRY_CHAR_LIMIT = 800;
const ACTIVE_PARTICIPANT_LIMIT = 4;

interface SessionEntry {
  messages: ConversationMessage[];
  lastAccessedAt: number;
}

interface MemoryFileV2 {
  version: 2;
  sessions: Record<string, ConversationMessage[]>;
}

interface MemoryFileV3 {
  version: 3;
  sessions: Record<string, { messages: ConversationMessage[]; lastAccessedAt: number }>;
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
  replyToAuthorId?: string | null;
  replyToAuthorName?: string | null;
  trigger?: string;
}

export interface BuildDiscordPromptOptions {
  incoming: PromptInput;
  history?: ConversationMessage[];
  bindingKey?: string;
  bossUserId?: string;
  promptHistoryMessageLimit?: number;
  promptHistoryCharBudget?: number;
  toolMode?: 'chat' | 'web';
}

export class ConversationMemory {
  private store: Map<string, SessionEntry>;
  private persistPath: string;
  private tmpPath: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;
  private maxEntries: number;

  constructor(extensionDir: string, historyLength: number) {
    this.persistPath = path.join(extensionDir, '.memory.json');
    this.tmpPath = this.persistPath + '.tmp';
    this.maxEntries = historyLength * 2;
    this.store = this.loadFromDisk();
  }

  add(sessionKey: string, message: ConversationMessage): void {
    if (!this.store.has(sessionKey)) {
      this.store.set(sessionKey, { messages: [], lastAccessedAt: Date.now() });
    }

    const entry = this.store.get(sessionKey)!;
    entry.lastAccessedAt = Date.now();
    entry.messages.push({
      ...message,
      content: message.content.slice(0, 2000),
      createdAt: message.createdAt ?? new Date().toISOString(),
    });

    while (entry.messages.length > this.maxEntries) {
      entry.messages.shift();
    }

    this.dirty = true;
  }

  reset(sessionKey: string): void {
    this.store.set(sessionKey, { messages: [], lastAccessedAt: Date.now() });
    this.dirty = true;
  }

  buildPrompt(sessionKey: string, incoming: PromptInput): string {
    this.touchSession(sessionKey);
    return buildDiscordPrompt({
      incoming,
      history: this.store.get(sessionKey)?.messages ?? [],
    });
  }

  snapshot(sessionKey: string): ConversationMessage[] {
    this.touchSession(sessionKey);
    return [...(this.store.get(sessionKey)?.messages ?? [])];
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
    this.flushTimer = setInterval(() => this.flushAsync(), 5000);
    this.evictionTimer = setInterval(() => this.evictStale(), EVICTION_INTERVAL_MS);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    // Synchronous final flush on shutdown
    this.flushSync();
  }

  flush(): void {
    this.flushSync();
  }

  /**
   * Async flush — non-blocking, used by the periodic timer.
   */
  async flushAsync(): Promise<void> {
    if (!this.dirty || this.flushInProgress) return;
    this.dirty = false;
    this.flushInProgress = true;

    try {
      const data = this.serializeV3();
      const json = JSON.stringify(data);
      await fsPromises.writeFile(this.tmpPath, json, { mode: 0o600 });
      await fsPromises.rename(this.tmpPath, this.persistPath);
    } catch (err) {
      log.error('Failed to flush memory to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.dirty = true;
    } finally {
      this.flushInProgress = false;
    }
  }

  /**
   * Synchronous flush — used only during shutdown to guarantee persistence.
   */
  private flushSync(): void {
    if (!this.dirty) return;
    this.dirty = false;

    try {
      const data = this.serializeV3();
      const json = JSON.stringify(data);
      fs.writeFileSync(this.tmpPath, json, { mode: 0o600 });
      fs.renameSync(this.tmpPath, this.persistPath);
    } catch (err) {
      log.error('Failed to sync-flush memory to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.dirty = true;
    }
  }

  /**
   * Evict stale sessions by TTL, then by LRU if over MAX_SESSIONS.
   */
  private evictStale(): void {
    const now = Date.now();
    let evictedCount = 0;

    // TTL eviction
    for (const [key, entry] of this.store) {
      if (now - entry.lastAccessedAt > SESSION_TTL_MS) {
        this.store.delete(key);
        evictedCount++;
      }
    }

    // LRU eviction if still over limit
    if (this.store.size > MAX_SESSIONS) {
      const sorted = [...this.store.entries()]
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

      while (this.store.size > MAX_SESSIONS && sorted.length) {
        const [key] = sorted.shift()!;
        this.store.delete(key);
        evictedCount++;
      }
    }

    if (evictedCount > 0) {
      this.dirty = true;
      log.info('Evicted stale memory sessions', {
        evicted: evictedCount,
        remaining: this.store.size,
      });
    }
  }

  private touchSession(sessionKey: string): void {
    const entry = this.store.get(sessionKey);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
  }

  private serializeV3(): MemoryFileV3 {
    const sessions: Record<string, { messages: ConversationMessage[]; lastAccessedAt: number }> = {};
    for (const [key, entry] of this.store) {
      sessions[key] = {
        messages: entry.messages,
        lastAccessedAt: entry.lastAccessedAt,
      };
    }
    return { version: 3, sessions };
  }

  private loadFromDisk(): Map<string, SessionEntry> {
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

  private tryParseFile(filePath: string): Map<string, SessionEntry> | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // V3 format (with lastAccessedAt)
      if (isMemoryFileV3(parsed)) {
        return coerceSessionsV3(parsed.sessions);
      }

      // V2 format (without lastAccessedAt — migrate)
      if (isMemoryFileV2(parsed)) {
        return coerceSessionsV2(parsed.sessions);
      }

      // Unknown format — attempt V2-style coercion
      if (typeof parsed === 'object' && parsed !== null) {
        return coerceSessionsV2(parsed as Record<string, unknown>);
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
  const { transcript, omittedCount } = buildTranscript(
    history,
    options.promptHistoryMessageLimit ?? DEFAULT_PROMPT_HISTORY_MESSAGE_LIMIT,
    options.promptHistoryCharBudget ?? DEFAULT_PROMPT_HISTORY_CHAR_BUDGET,
    options.bossUserId,
  );
  const historyBlock = omittedCount > 0
    ? `(omitted ${omittedCount} earlier messages from this prompt for speed; full conversation is still stored in persistent memory)\n${transcript}`
    : transcript;

  return `${buildDiscordAdapterInstruction({
    bindingKey: options.bindingKey,
    bossUserId: options.bossUserId,
    toolMode: options.toolMode ?? 'chat',
  })}

[Active Discord participants]
${buildActiveParticipantRoster(history, options.incoming, { bossUserId: options.bossUserId })}

[Conversation history]
${historyBlock}

[Incoming Discord message]
${formatIncomingDiscordMessage(options.incoming, { bossUserId: options.bossUserId })}`;
}

export function buildDiscordAdapterInstruction(options: {
  bindingKey?: string;
  bossUserId?: string;
  toolMode?: 'chat' | 'web';
} = {}): string {
  const toolMode = options.toolMode ?? 'chat';
  const context = options.bindingKey ? `Session: ${options.bindingKey}` : 'Discord conversation';

  const freshnessInstruction = toolMode === 'web'
    ? '- This turn is freshness-sensitive. Verify dynamic or recent facts with web/search before answering.'
    : '- If a question depends on dynamic or recent facts, verify with web/search before answering.';
  const bossLine = options.bossUserId
    ? `- Boss Discord ID: ${options.bossUserId}. Only the Boss may authorize privileged write/side-effect actions such as cross-channel sends or local write operations.`
    : '- Only the designated Boss may authorize privileged write/side-effect actions such as cross-channel sends or local write operations.';

  return `[DISCORD ADAPTER]
- You are operating inside Discord. Keep the existing Gemini identity and instructions you already have; do not invent or restate a new persona unless a user explicitly asks.
- Context: ${context}.
- You have full CLI tool access: shell commands, file read/write, web search, and all other tools. Use them when the task requires it.
- Distinguish Discord speakers by handle and ID. Never collapse multiple humans or agents into one generic "user".
- Resolve pronouns and references using the reply target first, then the recent participant roster and transcript.
- Never interpret "him", "her", or "them" as referring to yourself unless the message clearly points to you.
- Keep replies natural for Discord: readable markdown, concise by default, expand only when helpful.
- Image analysis is mandatory when attachments are present.
- Outbound images: to send an image as a Discord attachment, output a markdown image with the ABSOLUTE path (e.g. ![description](/absolute/path/to/local/image.png)).
- Local File Discovery: You are running on macOS. When asked for an image (e.g., "a random luffy image"), employ a two-step intelligent process: 1) First, search by name using Spotlight via the \`mdfind\` CLI tool (e.g., \`mdfind "luffy kind:image" | head -n 5\`). 2) If no files are found by name, use your innate image processing power to scan likely folders (e.g., list files in ~/Pictures or ~/Downloads) and analyze them to find one matching the description. NEVER run unbounded \`find /\` or \`find ~\`, as they will hang the daemon. Once found, output the ABSOLUTE path.
${bossLine}
- Read-only web grounding for truthfulness is allowed for any speaker when needed.
${freshnessInstruction}
${getChannelMapContext()}
[/DISCORD ADAPTER]`;
}

export function formatIncomingDiscordMessage(
  input: PromptInput,
  options: { bossUserId?: string } = {},
): string {
  const content = input.content || '(no text provided)';
  const location = input.guildName
    ? `${input.guildName} / ${input.channelName}`
    : `Direct Message / ${input.channelName}`;
  const attachments = formatAttachments(input.attachments) ?? 'Attachments: none';
  const replyTarget = input.replyToAuthorName
    ? `${input.replyToAuthorName}${input.replyToAuthorId ? ` (${input.replyToAuthorId})` : ''}`
    : (input.replyToMessageId ?? 'none');
  const trigger = input.trigger ?? 'channel';
  const speakerLabel = describeSpeaker(input.speakerKind, input.authorId, options.bossUserId);

  return `Speaker: ${input.authorName} (${speakerLabel})
Speaker ID: ${input.authorId}
Location: ${location}
Channel ID: ${input.channelId}
Message ID: ${input.messageId}
Trigger: ${trigger}
Reply Target: ${replyTarget}
${attachments}
Message: ${input.authorName}: ${content}`;
}

export function buildActiveParticipantRoster(
  history: ConversationMessage[],
  incoming: PromptInput,
  options: { bossUserId?: string } = {},
): string {
  const recentMessages = [...history.slice(-12)];
  recentMessages.push({
    role: 'user',
    content: incoming.content,
    speakerKind: incoming.speakerKind,
    authorId: incoming.authorId,
    authorName: incoming.authorName,
    channelId: incoming.channelId,
    channelName: incoming.channelName,
    guildId: incoming.guildId,
    guildName: incoming.guildName,
    messageId: incoming.messageId,
    replyToMessageId: incoming.replyToMessageId,
    replyToAuthorId: incoming.replyToAuthorId,
    replyToAuthorName: incoming.replyToAuthorName,
  });

  const seen = new Set<string>();
  const participants: string[] = [];

  for (let index = recentMessages.length - 1; index >= 0; index--) {
    const entry = recentMessages[index];
    if (!entry.authorId || !entry.authorName) continue;
    if (entry.role === 'assistant') continue;
    if (seen.has(entry.authorId)) continue;

    seen.add(entry.authorId);
    participants.push(`- ${entry.authorName} (${describeSpeaker(entry.speakerKind ?? 'human', entry.authorId, options.bossUserId)})`);

    if (participants.length >= ACTIVE_PARTICIPANT_LIMIT) {
      break;
    }
  }

  if (participants.length === 0) {
    return '(no recent non-assistant participants)';
  }

  return participants.join('\n');
}

export function formatConversationMessageForContext(
  entry: ConversationMessage,
  options: { bossUserId?: string } = {},
): string {
  const speaker = entry.authorName ?? (entry.role === 'assistant' ? 'Assistant' : 'Unknown speaker');
  const speakerKind = entry.role === 'assistant' ? 'assistant' : (entry.speakerKind ?? 'human');
  const location = entry.channelName
    ? (entry.guildName ? `${entry.guildName} / ${entry.channelName}` : `DM / ${entry.channelName}`)
    : 'Unknown location';
  const replyContext = entry.replyToAuthorName
    ? ` -> ${entry.replyToAuthorName}`
    : '';
  const attachments = formatAttachmentsInline(entry.attachments);

  return `${speaker} (${describeSpeaker(speakerKind, entry.authorId, options.bossUserId)}) in ${location}${replyContext}: ${truncateText(entry.content || '(no text provided)', TRANSCRIPT_ENTRY_CHAR_LIMIT)}${attachments}`;
}

function formatTranscriptEntry(entry: ConversationMessage, bossUserId?: string): string {
  return formatConversationMessageForContext(entry, { bossUserId });
}

function buildTranscript(
  history: ConversationMessage[],
  maxMessages: number,
  maxChars: number,
  bossUserId?: string,
): { transcript: string; omittedCount: number } {
  if (history.length === 0) {
    return {
      transcript: '(no prior Discord context in this session)',
      omittedCount: 0,
    };
  }

  const selected: string[] = [];
  let usedChars = 0;
  let omittedCount = 0;

  for (let index = history.length - 1; index >= 0; index--) {
    if (selected.length >= maxMessages) {
      omittedCount = index + 1;
      break;
    }

    const formatted = formatTranscriptEntry(history[index], bossUserId);
    const entryCost = formatted.length + 1;

    if (entryCost > maxChars && selected.length === 0) {
      selected.unshift(truncateText(formatted, maxChars));
      omittedCount = index;
      break;
    }

    if (usedChars + entryCost > maxChars) {
      omittedCount = index + 1;
      break;
    }

    selected.unshift(formatted);
    usedChars += entryCost;
  }

  return {
    transcript: selected.join('\n'),
    omittedCount,
  };
}

function isMemoryFileV2(value: unknown): value is MemoryFileV2 {
  if (typeof value !== 'object' || value === null) return false;
  const maybe = value as Partial<MemoryFileV2>;
  return maybe.version === 2 && typeof maybe.sessions === 'object' && maybe.sessions !== null;
}

function isMemoryFileV3(value: unknown): value is MemoryFileV3 {
  if (typeof value !== 'object' || value === null) return false;
  const maybe = value as Partial<MemoryFileV3>;
  return maybe.version === 3 && typeof maybe.sessions === 'object' && maybe.sessions !== null;
}

/**
 * Coerce V2 sessions (no lastAccessedAt) — migrates to SessionEntry format.
 */
function coerceSessionsV2(raw: Record<string, unknown>): Map<string, SessionEntry> {
  const map = new Map<string, SessionEntry>();
  const now = Date.now();

  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    map.set(key, {
      messages: value
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => coerceMessage(entry)),
      lastAccessedAt: now,
    });
  }

  return map;
}

/**
 * Coerce V3 sessions (with lastAccessedAt).
 */
function coerceSessionsV3(
  raw: Record<string, { messages: unknown; lastAccessedAt?: unknown }>,
): Map<string, SessionEntry> {
  const map = new Map<string, SessionEntry>();
  const now = Date.now();

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const messages = Array.isArray(value.messages) ? value.messages : [];
    map.set(key, {
      messages: messages
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => coerceMessage(entry)),
      lastAccessedAt: typeof value.lastAccessedAt === 'number' ? value.lastAccessedAt : now,
    });
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
    replyToAuthorId: optionalNullableString(entry.replyToAuthorId),
    replyToAuthorName: optionalNullableString(entry.replyToAuthorName),
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

function describeSpeaker(
  speakerKind: ConversationMessage['speakerKind'] | PromptInput['speakerKind'],
  authorId: string | undefined,
  bossUserId?: string,
): string {
  if (authorId && bossUserId && authorId === bossUserId) {
    return 'boss';
  }

  switch (speakerKind) {
    case 'agent':
      return 'peer agent';
    case 'assistant':
      return 'assistant';
    default:
      return 'human';
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
