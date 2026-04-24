import { describe, expect, it } from 'vitest';
import { extractGeminiResultText, getGeminiTextDelta } from '../src/daemon/gemini-output.js';

describe('extractGeminiResultText', () => {
  it('extracts direct response fields from result payloads', () => {
    expect(extractGeminiResultText({ response: 'It is Marceline.' })).toBe('It is Marceline.');
  });

  it('extracts nested response text from multimodal result payloads', () => {
    expect(extractGeminiResultText({ result: { output: { response: 'This looks like Marceline.' } } }))
      .toBe('This looks like Marceline.');
  });

  it('joins non-thought text parts when response is delivered as parts', () => {
    expect(extractGeminiResultText({
      parts: [
        { text: 'This is ' },
        { thought: true, text: 'internal' },
        { text: 'Marceline.' },
      ],
    })).toBe('This is Marceline.');
  });
});

describe('getGeminiTextDelta', () => {
  it('returns the whole string when nothing has been streamed yet', () => {
    expect(getGeminiTextDelta('', 'hello')).toBe('hello');
  });

  it('deduplicates repeated final result text after streamed chunks', () => {
    expect(getGeminiTextDelta('hello', 'hello')).toBe('');
    expect(getGeminiTextDelta('hello', 'hello world')).toBe(' world');
  });
});
