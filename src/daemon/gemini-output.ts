function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function extractGeminiResultText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => extractGeminiResultText(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .join('');
    return joined || null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const directFields = ['response', 'text', 'content'] as const;
  for (const field of directFields) {
    const candidate = record[field];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const parts = record['parts'];
  if (Array.isArray(parts)) {
    const joined = parts
      .map((part) => {
        const partRecord = asRecord(part);
        if (!partRecord || partRecord['thought'] === true) {
          return '';
        }
        return typeof partRecord['text'] === 'string' ? partRecord['text'] : '';
      })
      .join('');

    if (joined.length > 0) {
      return joined;
    }
  }

  const nestedFields = ['result', 'output', 'message'] as const;
  for (const field of nestedFields) {
    const nested = extractGeminiResultText(record[field]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function getGeminiTextDelta(existing: string, incoming: string): string {
  if (!incoming || incoming === existing) {
    return '';
  }

  if (!existing) {
    return incoming;
  }

  if (incoming.startsWith(existing)) {
    return incoming.slice(existing.length);
  }

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return incoming.slice(overlap);
    }
  }

  return incoming;
}
