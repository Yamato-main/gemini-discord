import { describe, expect, it } from 'vitest';
import { buildGeminiCliPrompt } from '../src/daemon/gemini-input.js';

describe('buildGeminiCliPrompt', () => {
  it('preserves the direct CLI file-ref layout', () => {
    expect(buildGeminiCliPrompt('what is in this image?', ['discord-attachments/1-cat.png']))
      .toBe('@discord-attachments/1-cat.png\n\nwhat is in this image?');
  });

  it('keeps multiple attachments in front of the prompt in order', () => {
    expect(buildGeminiCliPrompt('compare these', ['one.png', 'two.png']))
      .toBe('@one.png @two.png\n\ncompare these');
  });
});
