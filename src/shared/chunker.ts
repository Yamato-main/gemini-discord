/**
 * Markdown-safe message chunker for Discord's 2000-character limit.
 * Preserves code fences across chunk boundaries.
 */

const CHUNK_LIMIT = 1990;
const LARGE_RESPONSE_CUT = 6000;

/**
 * Split a message into Discord-safe chunks.
 * Preserves markdown code fences and paragraph boundaries.
 * Truncates responses exceeding LARGE_RESPONSE_CUT with a warning.
 */
export function chunkMessage(text: string): string[] {
  let wasTruncated = false;

  if (text.length > LARGE_RESPONSE_CUT) {
    text = text.slice(0, LARGE_RESPONSE_CUT);
    wasTruncated = true;
  }

  if (text.length <= CHUNK_LIMIT) {
    const result = [text];
    if (wasTruncated) {
      result.push('⚠️ Response truncated. Ask me to continue or narrow the question.');
    }
    return result;
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > CHUNK_LIMIT) {
    const splitAt = findSafeSplit(remaining, CHUNK_LIMIT);
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);

  if (wasTruncated) {
    chunks.push('⚠️ Response truncated. Ask me to continue or narrow the question.');
  }

  return chunks.filter(Boolean);
}

/**
 * Find a safe split point that doesn't break markdown code fences.
 * Prefers paragraph breaks (double newline) > line breaks > hard cut.
 */
function findSafeSplit(text: string, limit: number): number {
  let insideFence = false;
  let lastSafeParaBreak = -1;
  let lastSafeNewline = -1;

  for (let i = 0; i < limit && i < text.length; i++) {
    // Track code fence boundaries
    if (
      text[i] === '`' &&
      i + 2 < text.length &&
      text[i + 1] === '`' &&
      text[i + 2] === '`'
    ) {
      insideFence = !insideFence;
      i += 2; // skip the fence
      continue;
    }

    if (!insideFence) {
      // Double newline = paragraph break (strongest)
      if (text[i] === '\n' && i + 1 < text.length && text[i + 1] === '\n') {
        lastSafeParaBreak = i + 2;
      }
      // Single newline
      if (text[i] === '\n') {
        lastSafeNewline = i + 1;
      }
    }
  }

  // Prefer paragraph breaks if they're past 40% of the limit
  if (lastSafeParaBreak > limit * 0.4) return lastSafeParaBreak;
  // Fall back to line breaks if past 30%
  if (lastSafeNewline > limit * 0.3) return lastSafeNewline;
  // Hard split as last resort
  return limit;
}
