import type { Config, SpeakerKind } from '../shared/types.js';

export interface RoutingInput {
  authorId: string;
  authorTag: string;
  isBot: boolean;
  botUserId: string | null;
  content: string;
  attachmentCount: number;
  channelId: string;
  channelName: string;
  guildId: string | null;
  guildName: string | null;
  isDM: boolean;
  mentionedBot: boolean;
  repliedToBot: boolean;
  replyToMessageId: string | null;
}

export interface RoutingDecision {
  accept: boolean;
  trackOnly?: boolean;
  content: string;
  speakerKind?: SpeakerKind;
  trigger?: string;
}

export function shouldAcceptMessage(input: RoutingInput, config: Config): RoutingDecision {
  if (input.authorId === input.botUserId && !input.content.startsWith('[CRON]')) {
    return reject();
  }

  if (input.isDM) {
    if (!config.enableDMs) return reject();
    // Security: Only the configured Boss may DM the bot directly.
    if (input.authorId !== config.discordBossId) return reject();
    return finalizeRoute(input, config, 'dm');
  }

  if (!config.allowedChannelIds.includes(input.channelId)) {
    return reject();
  }

  const isBoss = input.authorId === config.discordBossId;
  const isSelf = input.authorId === input.botUserId;

  // Humans must be in the allowlist
  if (!input.isBot && !config.allowedUserIds.includes(input.authorId)) {
    return reject();
  }

  // For DMs, we are strict. For servers, we allow all humans to trigger.
  if (input.isDM && !isBoss) {
    return reject();
  }

  // Agents are strictly blocked unless they are the bot itself (CRON) or in allowed list.
  if (input.isBot && !isSelf && !config.allowedAgentIds.includes(input.authorId)) {
    return reject();
  }

  const speakerKind: SpeakerKind = isSelf || input.isBot ? 'agent' : 'human';
  let contentToStrip = input.content;
  let isCron = false;
  if (contentToStrip.startsWith('[CRON]')) {
    contentToStrip = contentToStrip.slice(6).trim();
    isCron = true;
  }
  const stripped = stripLeadingBotMention(stripPrefix(contentToStrip, config.discordPrefix), input.botUserId);
  const hasExplicitTrigger = isCron || stripped.usedPrefix || input.mentionedBot || (config.respondToReplies && input.repliedToBot);
  const normalized = stripped.content.trim();

  // Trigger Enforcement
  if (!input.isDM && !hasExplicitTrigger) {
    // If requireMention is true, we must have a prefix/mention/reply
    if (config.requireMention) return trackOnly(normalized, speakerKind);
    
    // Peer agents MUST always have an explicit trigger to prevent infinite loops
    if (input.isBot) return trackOnly(normalized, speakerKind);
  }

  if (!normalized && input.attachmentCount === 0) {
    return reject();
  }

  const trigger = input.isDM
    ? 'dm'
    : stripped.usedPrefix
      ? 'prefix'
      : input.mentionedBot
        ? 'mention'
        : input.repliedToBot
          ? 'reply'
          : isCron ? 'cron' : 'channel';

  return {
    accept: true,
    content: normalized,
    speakerKind,
    trigger,
  };
}

function trackOnly(content: string, speakerKind: SpeakerKind): RoutingDecision {
  return { accept: false, trackOnly: true, content, speakerKind };
}


function stripPrefix(content: string, prefix: string): { content: string; usedPrefix: boolean } {
  const trimmed = content.trim();
  if (!prefix) {
    return { content: trimmed, usedPrefix: false };
  }

  if (!trimmed.startsWith(prefix)) {
    return { content: trimmed, usedPrefix: false };
  }

  return {
    content: trimmed.slice(prefix.length).trim(),
    usedPrefix: true,
  };
}

function stripLeadingBotMention(
  input: { content: string; usedPrefix: boolean },
  botUserId: string | null,
): { content: string; usedPrefix: boolean } {
  if (!botUserId) return input;

  const mentionPatterns = [`<@${botUserId}>`, `<@!${botUserId}>`];
  let content = input.content.trim();
  for (const pattern of mentionPatterns) {
    if (content.startsWith(pattern)) {
      content = content.slice(pattern.length).trim();
      break;
    }
  }

  return { content, usedPrefix: input.usedPrefix };
}

function finalizeRoute(
  input: RoutingInput,
  config: Config,
  fallbackTrigger: string,
): RoutingDecision {
  if (input.isBot && !config.allowedAgentIds.includes(input.authorId)) {
    return reject();
  }

  // We allow all humans in the routing decision now.
  // Guests are handled by the trigger logic in shouldAcceptMessage.

  const stripped = stripLeadingBotMention(stripPrefix(input.content, config.discordPrefix), input.botUserId);
  const normalized = stripped.content.trim();
  if (!normalized && input.attachmentCount === 0) {
    return reject();
  }

  return {
    accept: true,
    content: normalized,
    speakerKind: input.isBot ? 'agent' : 'human',
    trigger: stripped.usedPrefix ? 'prefix' : fallbackTrigger,
  };
}

function reject(): RoutingDecision {
  return { accept: false, content: '' };
}
