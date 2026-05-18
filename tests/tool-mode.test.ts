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
    expect(resolveToolMode('latest TypeScript release')).toBe('web');
  });

  it('enables discord action mode for channel operations', () => {
    expect(resolveToolMode('post a reminder to #general in 10 minutes')).toBe('discord');
    expect(resolveToolMode('reply to that message on Discord')).toBe('discord');
  });

  it('enables discord action mode for local media delivery requests', () => {
    expect(resolveToolMode('please fetch me a random image from my device')).toBe('discord');
    expect(resolveToolMode('grab a screenshot from my computer')).toBe('discord');
    expect(resolveToolMode('attach this photo here')).toBe('discord');
    expect(resolveToolMode('send me a random video from my device')).toBe('discord');
    expect(resolveToolMode('upload an audio clip from my mac')).toBe('discord');
  });

  it('enables combined web + discord mode for research-and-report tasks', () => {
    expect(resolveToolMode('research across multiple sites and post the summary to Discord')).toBe('web_discord');
    expect(resolveToolMode('look up the latest TypeScript release notes and report back in 30 minutes')).toBe('web_discord');
  });

  it('reserves full mode for explicit shell/code requests', () => {
    expect(resolveToolMode('use full tools and inspect the repo')).toBe('full');
    expect(resolveToolMode('edit the code and patch the project')).toBe('full');
  });
});
