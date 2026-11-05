export type ToolMode = 'chat' | 'web' | 'discord' | 'web_discord' | 'full';

const EXPLICIT_WEB_TOOL_PATTERNS = [
  /\bsearch(?: the web| online)?\b/i,
  /\bweb\s*search\b/i,
  /\blook\s*up\b/i,
  /\blookup\b/i,
  /\bresearch\b/i,
  /\bbrowse\b/i,
  /\bgoogle\b/i,
  /\bfind online\b/i,
  /\bcheck online\b/i,
  /\bverify online\b/i,
  /\buse tools?\b/i,
  /\buse search\b/i,
  /(?:https?:\/\/)?(?:www\.)?reddit\.com/i,
  /(?:https?:\/\/)?(?:www\.)?github\.com/i,
  /(?:https?:\/\/)?(?:www\.)?stackoverflow\.com/i,
  /https?:\/\/[^\s]+/i,
];

const DISCORD_ACTION_PATTERNS = [
  /\bsend (?:a )?(?:message|reply)\b/i,
  /\bpost (?:a )?(?:message|reply|reminder|update)\b/i,
  /\bremind(?: me)?\b/i,
  /\breminder\b/i,
  /\bcron\b/i,
  /\bschedule\b/i,
  /\bmonitor\b/i,
  /\breport back\b/i,
  /\bfollow up\b/i,
  /\bcheck back\b/i,
  /\b(?:list|show|discover|find) (?:the )?channels?\b/i,
  /\b(?:create|start|make|open) (?:a )?(?:new )?(?:discord )?thread\b/i,
  /\bthread (?:called|named)\b/i,
  /\bdiscord\b/i,
  /\breply to\b/i,
  /\breset (?:the )?(?:session|conversation)\b/i,
  /\bstart (?:a )?new session\b/i,
  /\bhistory\b/i,
  /\bfind (?:an |the )?images?\b/i,
  /\b(?:find|send|attach|fetch|get|grab|show|upload)\b.*\b(?:media|files?|images?|photos?|pictures?|screenshots?|videos?|movies?|audio|songs?|music|clips?|gifs?)\b/i,
  /\b(?:media|files?|images?|photos?|pictures?|screenshots?|videos?|movies?|audio|songs?|music|clips?|gifs?)\b.*\b(?:from|on) (?:my|the) (?:device|computer|mac|machine)\b/i,
  /\brandom (?:media|files?|images?|photos?|pictures?|videos?|movies?|audio|songs?|clips?|gifs?)\b/i,
];

const CHANNEL_DELIVERY_ACTIONS = 'send|post|write|put|drop|move|copy';
const CHANNEL_DELIVERY_REQUEST_RE = new RegExp(
  `\\b(?:${CHANNEL_DELIVERY_ACTIONS})\\b[\\s\\S]*?\\b(?:to|in|into)\\s+([^.!?\\n,;]+)`,
  'gi',
);
const OWN_ACTION_ADVICE_PREFIX_RE = new RegExp(
  '\\b(?:(?:what|where|when)\\s+(?:should|can|could|would)|how\\s+(?:do|can|should|could|would)|should|can|could|would)\\s+(?:i|we)\\s+$',
  'i',
);

const FULL_TOOL_PATTERNS = [
  /\buse full tools?\b/i,
  /\bterminal\b/i,
  /\bshell\b/i,
  /\brun (?:a |the )?command\b/i,
  /\bexecute (?:a |the )?command\b/i,
  /\bedit (?:the )?(?:code|file|project)\b/i,
  /\bmodify (?:the )?(?:code|file|project)\b/i,
  /\bpatch (?:the )?(?:code|file|project)\b/i,
  /\binspect (?:the )?repo\b/i,
  /\bwork on (?:the )?codebase\b/i,
];

const FRESHNESS_SENSITIVE_PATTERNS = [
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\btoday'?s?\b/i,
  /\bnow\b/i,
  /\brecent\b/i,
  /\bnewest\b/i,
  /\bjust released\b/i,
  /\brelease(?:d| date)?\b/i,
  /\bchapter\b/i,
  /\bepisode\b/i,
  /\bprice\b/i,
  /\bscore\b/i,
  /\bweather\b/i,
  /\bversion\b/i,
  /\bupdate(?:d|s)?\b/i,
  /\boutage\b/i,
  /\btrending\b/i,
];

/**
 * Resolve whether the user is explicitly asking for a tool-heavy turn.
 * Used for UX (placeholder timing) and --allowed-tools selection.
 */
export function resolveToolMode(content: string): ToolMode {
  const normalized = content.trim();
  if (!normalized) {
    return 'chat';
  }

  if (FULL_TOOL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'full';
  }

  const contentForFreshness = withoutExplicitChannelDeliveryTargets(normalized);
  const wantsWeb = (
    EXPLICIT_WEB_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    FRESHNESS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(contentForFreshness))
  );
  const wantsDiscord = (
    DISCORD_ACTION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    hasExplicitChannelDeliveryIntent(normalized)
  );

  if (wantsWeb && wantsDiscord) {
    return 'web_discord';
  }

  if (wantsDiscord) {
    return 'discord';
  }

  if (wantsWeb) {
    return 'web';
  }

  return 'chat';
}

function hasExplicitChannelDeliveryIntent(content: string): boolean {
  CHANNEL_DELIVERY_REQUEST_RE.lastIndex = 0;
  for (let match = CHANNEL_DELIVERY_REQUEST_RE.exec(content); match; match = CHANNEL_DELIVERY_REQUEST_RE.exec(content)) {
    if (OWN_ACTION_ADVICE_PREFIX_RE.test(content.slice(0, match.index))) {
      continue;
    }
    if (isExplicitChannelTarget(match[1] ?? '')) {
      return true;
    }
  }

  return false;
}

function withoutExplicitChannelDeliveryTargets(content: string): string {
  return content.replace(CHANNEL_DELIVERY_REQUEST_RE, (match, target: string) => (
    isExplicitChannelTarget(target) ? '' : match
  ));
}

function isExplicitChannelTarget(rawTarget: string): boolean {
  const target = rawTarget.trim().replace(/^["'`]+|["'`]+$/g, '').toLowerCase();
  if (!target) {
    return false;
  }
  const targetWithoutArticle = target.replace(/^(?:the|a)\s+/, '');

  if (/^<#[0-9]{15,25}>/.test(targetWithoutArticle)) {
    return true;
  }

  if (/^#[a-z0-9_-]+(?:\s+channel)?\b/i.test(targetWithoutArticle)) {
    return true;
  }

  if (/^(?:(?:the|a)\s+)?(?:another|other|different|separate|specific)\s+channel\b/.test(target)) {
    return true;
  }

  if (/^(?:(?:the|a|this|that|my|our|your)\s+)?(?:current|same|origin|source|this|that)\s+channel\b/.test(target)) {
    return false;
  }

  if (/^(?:the|a|my|our|your)\s+channel\b/.test(target)) {
    return false;
  }

  if (/^(?:(?:the|a|my|our|your)\s+)?[a-z0-9][a-z0-9_-]*(?:\s+[a-z0-9][a-z0-9_-]*)*\s+channel\b/i.test(target)) {
    return true;
  }

  return /^[a-z0-9][a-z0-9_-]*-channel\b/i.test(target);
}
