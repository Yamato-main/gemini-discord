import { describe, it, expect } from 'vitest';
import { chunkMessage } from '../src/shared/chunker.js';

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = chunkMessage('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('returns single chunk at exactly CHUNK_LIMIT', () => {
    const msg = 'a'.repeat(1990);
    const result = chunkMessage(msg);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1990);
  });

  it('splits long messages into multiple chunks', () => {
    const msg = ('Line of text.\n').repeat(200); // ~2800 chars
    const result = chunkMessage(msg);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(1990);
    }
  });

  it('truncates responses over 6000 chars with warning', () => {
    const msg = 'x'.repeat(7000);
    const result = chunkMessage(msg);
    const lastChunk = result[result.length - 1];
    expect(lastChunk).toContain('truncated');
  });

  it('preserves code fences across chunks', () => {
    // Build a message with a code fence that spans the chunk boundary
    const before = 'a'.repeat(1800) + '\n';
    const fence = '```\ncode line 1\ncode line 2\ncode line 3\n```\n';
    const msg = before + fence;
    const result = chunkMessage(msg);

    // The code fence should NOT be split in the middle
    for (const chunk of result) {
      const opens = (chunk.match(/```/g) ?? []).length;
      // Each chunk should have an even number of fence markers (0 or 2)
      // OR the fence is intact within a single chunk
      expect(opens % 2).toBe(0);
    }
  });

  it('splits at paragraph breaks preferentially', () => {
    const para1 = 'a'.repeat(1000);
    const para2 = 'b'.repeat(1000);
    const msg = para1 + '\n\n' + para2;
    const result = chunkMessage(msg);
    expect(result).toHaveLength(2);
    expect(result[0].trim()).toBe(para1);
    expect(result[1].trim()).toBe(para2);
  });

  it('handles empty string', () => {
    const result = chunkMessage('');
    expect(result).toEqual(['']);
  });
});
