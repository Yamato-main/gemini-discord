/**
 * Markdown-safe message chunker for Discord's 2000-character limit.
 * Preserves code fences across chunk boundaries with automatic repair.
 */

const CHUNK_LIMIT = 1990;
const LARGE_RESPONSE_CUT = 8000;

/**
 * Split a message into Discord-safe chunks.
 * Preserves markdown code fences and paragraph boundaries.
 * Repairs broken fences across chunk boundaries.
 * Truncates responses exceeding LARGE_RESPONSE_CUT with a warning.
 */
export function chunkMessage(text: string): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  let wasTruncated = false;

  if (text.length > LARGE_RESPONSE_CUT) {
    // Truncate at a fence-safe boundary
    text = safeTruncate(text, LARGE_RESPONSE_CUT);
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

  // Repair any code fences broken across chunk boundaries
  const repaired = repairFences(chunks.filter(Boolean));
  return repaired;
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

/**
 * Truncate text at a fence-safe boundary.
 * Ensures we don't cut inside an open code fence.
 */
function safeTruncate(text: string, limit: number): string {
  const truncated = text.slice(0, limit);

  // Count fence toggles
  let insideFence = false;
  const fenceRegex = /^```/gm;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(truncated)) !== null) {
    insideFence = !insideFence;
  }

  // If we're inside a fence after truncation, close it
  if (insideFence) {
    return truncated + '\n```';
  }

  return truncated;
}

/**
 * Repair code fences broken across chunk boundaries.
 * If a chunk ends inside an open fence, closes it and opens the next chunk
 * with the same fence language.
 */
function repairFences(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;

  const repaired: string[] = [];
  let carryFence: string | null = null;

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    // If previous chunk left a fence open, re-open it here
    if (carryFence) {
      chunk = carryFence + '\n' + chunk;
      carryFence = null;
    }

    // Count fence state in this chunk
    let insideFence = false;
    let lastOpenFence = '';
    const lines = chunk.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        if (!insideFence) {
          insideFence = true;
          lastOpenFence = trimmed; // e.g. "```typescript"
        } else {
          insideFence = false;
          lastOpenFence = '';
        }
      }
    }

    if (insideFence && i < chunks.length - 1) {
      // This chunk ends inside a code fence — close it, carry to next
      chunk += '\n```';
      carryFence = lastOpenFence || '```';
    }

    repaired.push(chunk);
  }

  return repaired;
}
