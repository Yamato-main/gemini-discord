/**
 * Message sanitization logic for stripping Chain-of-Thought (CoT) and metadata.
 */

export const RE_THOUGHT_TAGS = /\[Thought:?\s*(true|false)?\]/g;
export const RE_THOUGHT_SIMPLE = /\[Thought\]/g;
export const RE_ANALYZING_HEADER = /\*\*Analyzing[^\*]+\*\*/g;


export const RE_EXCESSIVE_LINES = /\n{3,}/g;
export const RE_SEND_DIRECTIVE = /\[SEND:[^\]]+\][\s\S]*?\[\/SEND\]/g;
export const RE_MARKDOWN_IMAGE = /!\[[^\]]*]\(((?:https?:\/\/|file:\/\/|\/)[^)]+)\)/g;

/**
 * Strips internal reasoning and chain-of-thought leaks from the final response.
 */
export function sanitizeFullResponse(text: string): string {
  if (!text) return '';

  return text
    .replace(RE_THOUGHT_TAGS, '')
    .replace(RE_THOUGHT_SIMPLE, '')
    .replace(RE_SEND_DIRECTIVE, '')
    .replace(RE_EXCESSIVE_LINES, '\n\n')
    .trim();
}

/**
 * Lightweight sanitizer for live streaming chunks.
 * Keeps images hidden during streaming to prevent visual glitches.
 */
export function sanitizeStreamChunk(text: string): string {
  if (!text) return '';

  return text
    .replace(RE_THOUGHT_TAGS, '')
    .replace(RE_THOUGHT_SIMPLE, '')
    .replace(RE_ANALYZING_HEADER, '')
    .replace(RE_SEND_DIRECTIVE, '')
    .replace(RE_MARKDOWN_IMAGE, '');
}
