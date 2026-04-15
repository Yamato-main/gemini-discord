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
  content: string;
  speakerKind?: SpeakerKind;
  trigger?: string;
}

export function shouldAcceptMessage(input: RoutingInput, config: Config): RoutingDecision {
  if (input.authorId === input.botUserId) {
    return reject();
  }

  if (input.isDM) {
    if (!config.enableDMs) return reject();
    return finalizeRoute(input, config, 'dm');
  }

  if (!config.allowedChannelIds.includes(input.channelId)) {
    return reject();
  }

  const isAllowedHuman =
    !input.isBot &&
    (config.allowedUserIds.includes(input.authorId) || config.ownerIds.includes(input.authorId));
  const isAllowedAgent = input.isBot && config.allowedAgentIds.includes(input.authorId);

  if (!isAllowedHuman && !isAllowedAgent) {
    return reject();
  }

  const speakerKind: SpeakerKind = isAllowedAgent ? 'agent' : 'human';
  const stripped = stripLeadingBotMention(stripPrefix(input.content, config.discordPrefix), input.botUserId);
  const hasExplicitTrigger = stripped.usedPrefix || input.mentionedBot || (config.respondToReplies && input.repliedToBot);

  if (speakerKind === 'agent' && !hasExplicitTrigger) {
    return reject();
  }

  if (speakerKind === 'human' && config.requireMention && !hasExplicitTrigger) {
    return reject();
  }

  const normalized = stripped.content.trim();
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
          : 'channel';

  return {
    accept: true,
    content: normalized,
    speakerKind,
    trigger,
  };
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

  if (!input.isBot) {
    const isAllowedHuman =
      config.allowedUserIds.includes(input.authorId) || config.ownerIds.includes(input.authorId);
    if (!isAllowedHuman) {
      return reject();
    }
  }

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
