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
  // High-velocity/structured sites that require DCP web fetching
  /(?:https?:\/\/)?(?:www\.)?4chan\.org/i,
  /(?:https?:\/\/)?(?:www\.)?4cdn\.org/i,
  /(?:https?:\/\/)?(?:www\.)?reddit\.com/i,
  /(?:https?:\/\/)?(?:www\.)?github\.com/i,
  /(?:https?:\/\/)?(?:www\.)?stackoverflow\.com/i,
];

const DISCORD_ACTION_PATTERNS = [
  /\bsend (?:a )?(?:message|reply)\b/i,
  /\bpost (?:a )?(?:message|reply|reminder|update)\b/i,
  /\bremind(?: me| yamato)?\b/i,
  /\breminder\b/i,
  /\bcron\b/i,
  /\bschedule\b/i,
  /\bchannel\b/i,
  /\bdiscord\b/i,
  /\breply to\b/i,
  /\breset (?:the )?(?:session|conversation)\b/i,
  /\bstart (?:a )?new session\b/i,
  /\bhistory\b/i,
  /\bfind (?:an |the )?image\b/i,
];

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

  const wantsWeb = (
    EXPLICIT_WEB_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    FRESHNESS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
  const wantsDiscord = DISCORD_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));

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
