/**
 * Shared TypeScript interfaces for gemini-discord.
 * Used by both daemon (Track 1) and MCP server (Track 2).
 */

export type MemoryScope = 'global' | 'channel';
export type SpeakerKind = 'human' | 'agent' | 'assistant';
export type GeminiSessionBindingScope = 'global' | 'server' | 'channel';

export interface ConversationAttachment {
  name: string;
  contentType?: string;
  sizeBytes?: number;
  url?: string;
}

/** Frozen config object parsed from .env */
export interface Config {
  // Required
  discordBotToken: string;
  discordChannelId: string;
  ownerIds: string[];
  allowedChannelIds: string[];

  // Routing / identity
  allowedUserIds: string[];
  allowedAgentIds: string[];

  // Internal
  daemonApiToken: string;

  // Optional with defaults
  discordPrefix: string;
  discordResetCmd: string;
  daemonPort: number;
  geminiPath: string;
  geminiModel: string;
  geminiTimeoutMs: number;
  conversationHistoryLength: number;
  streaming: boolean;
  queueMaxDepth: number;
  enableDMs: boolean;
  requireMention: boolean;
  respondToReplies: boolean;
  memoryScope: MemoryScope;
  autoStartDaemon: boolean;
  useGeminiCliSessions: boolean;
  geminiSessionBindingScope: GeminiSessionBindingScope;
}

/** A single conversation message stored in persistent memory */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ConversationAttachment[];
  speakerKind?: SpeakerKind;
  authorId?: string;
  authorName?: string;
  channelId?: string;
  channelName?: string;
  guildId?: string | null;
  guildName?: string | null;
  messageId?: string;
  replyToMessageId?: string | null;
  trigger?: string;
  createdAt?: string;
}

/** A logged exchange in the daemon's recent history */
export interface ExchangeLog {
  at: string;
  author: string;
  authorId: string;
  authorType: SpeakerKind;
  channelId: string;
  channelName: string;
  guildId: string | null;
  guildName: string | null;
  requestMessageId: string;
  responseMessageIds: string[];
  attachmentCount: number;
  trigger: string;
  prompt: string;
  response: string;
  elapsedMs: number;
}

export interface HistoryParticipant {
  id: string;
  name: string;
  kind: SpeakerKind;
}

export interface HistoryChannel {
  id: string;
  name: string;
}

/** Daemon status response from GET /status */
export interface DaemonStatus {
  status: 'starting' | 'ready' | 'degraded';
  startedAt: string;
  geminiReachable: boolean;
  geminiVersion: string;
  messagesHandled: number;
  lastMessageAt: string | null;
  lastError: string | null;
  queueDepth: number;
  streaming: boolean;
  botTag: string | null;
  wsPing: number;
  channelId: string;
  ownerIds: string[];
  enableDMs: boolean;
  sessionScope: MemoryScope;
  geminiSessionBindingScope: GeminiSessionBindingScope;
  useGeminiCliSessions: boolean;
  allowlistedUsers: number;
  allowlistedAgents: number;
  requireMention: boolean;
}

/** Daemon history response from GET /history */
export interface DaemonHistory {
  sessionKey: string;
  messages: ExchangeLog[];
  conversation: ConversationMessage[];
  participants: HistoryParticipant[];
  channels: HistoryChannel[];
}

/** POST /send response */
export interface SendResponse {
  ok: boolean;
  chunks?: number;
  messageIds?: string[];
  error?: string;
}

/** POST /reply response */
export interface ReplyResponse {
  ok: boolean;
  messageIds?: string[];
  error?: string;
}

/** POST /reset response */
export interface ResetResponse {
  ok: boolean;
  error?: string;
}
