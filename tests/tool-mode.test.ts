import { describe, expect, it } from 'vitest';
import { resolveToolMode } from '../src/daemon/tool-mode.js';

describe('resolveToolMode', () => {
  it('defaults to chat mode for normal conversation', () => {
    expect(resolveToolMode('hey')).toBe('chat');
    expect(resolveToolMode('what do you think about this?')).toBe('chat');
  });

  it('enables web mode for explicit search requests', () => {
    expect(resolveToolMode('search the web for the latest OpenAI API changes')).toBe('web');
    expect(resolveToolMode('look up today’s bitcoin price')).toBe('web');
    expect(resolveToolMode('please research this and use tools if needed')).toBe('web');
    expect(resolveToolMode('latest One Piece chapter')).toBe('web');
  });
});
