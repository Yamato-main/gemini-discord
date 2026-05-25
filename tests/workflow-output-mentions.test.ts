import { describe, expect, it, vi } from 'vitest';
import { LiveEditor } from '../src/daemon/editor.js';
import { sendPreparedDisplayText } from '../src/daemon/engine-cli.js';

describe('workflow output mention safety', () => {
  it('suppresses mentions on non-streaming workflow responses so tool output cannot ping Discord users', async () => {
    const channel = {
      send: vi.fn().mockResolvedValue({ id: 'message-1' }),
    };

    const messageIds = await sendPreparedDisplayText(
      channel as any,
      '@everyone review <@123456789012345678>',
      { suppressMentions: true },
    );

    expect(messageIds).toEqual(['message-1']);
    expect(channel.send).toHaveBeenCalledWith({
      content: '@everyone review <@123456789012345678>',
      allowedMentions: { parse: [] },
    });
  });

  it('suppresses mentions on streaming workflow responses before the final edit/send', async () => {
    const channel = {
      sendTyping: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ id: 'message-1', edit: vi.fn() }),
    };
    const editor = new LiveEditor({ placeholderDelayMs: null, suppressMentions: true });

    await editor.init(channel as any);
    const messageIds = await editor.finalize('@everyone shipped', (text) => [text]);

    expect(messageIds).toEqual(['message-1']);
    expect(channel.send).toHaveBeenCalledWith({
      content: '@everyone shipped',
      allowedMentions: { parse: [] },
    });
  });
});
