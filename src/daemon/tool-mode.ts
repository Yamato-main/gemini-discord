export type ToolMode = 'chat' | 'web';

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

  return (
    EXPLICIT_WEB_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    FRESHNESS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))
  )
    ? 'web'
    : 'chat';
}
