import { describe, expect, it } from 'vitest';
import { buildGeminiCliPrompt } from '../src/daemon/gemini-input.js';

describe('buildGeminiCliPrompt', () => {
  it('preserves the direct CLI file-ref layout', () => {
    const prompt = buildGeminiCliPrompt('what is in this image?', ['discord-attachments/1-cat.png']);

    expect(prompt).toContain('@discord-attachments/1-cat.png');
    expect(prompt).toContain('Use the attached file content as the primary evidence');
    expect(prompt).toContain('what is in this image?');
  });

  it('keeps multiple attachments in front of the prompt in order', () => {
    expect(buildGeminiCliPrompt('compare these', ['one.png', 'two.png']))
      .toContain('@one.png @two.png');
  });
});
