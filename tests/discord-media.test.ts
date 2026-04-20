import { describe, it, expect, vi } from 'vitest';
import { findRemoteImageCandidates, prepareDiscordMessageContent } from '../src/daemon/discord-media.js';

describe('Discord Media Deduplication', () => {
  it('findRemoteImageCandidates should deduplicate the same URL in markdown and standalone formats', () => {
    const url = 'https://example.com/luffy.png';
    const content = `Check this out: ![luffy](${url}) and also ${url}`;
    
    const candidates = findRemoteImageCandidates(content);
    
    expect(candidates).toHaveLength(1);
    expect(candidates[0].url).toBe(url);
  });

  it('prepareDiscordMessageContent should clean all instances of a URL once attached', async () => {
    // We need to mock global fetch since it's used in downloadRemoteImage
    // But since downloadRemoteImage is internal, it's easier to mock the global fetch
    global.fetch = vi.fn().mockImplementation(() => 
      Promise.resolve({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      })
    );

    const url = 'https://example.com/luffy.png';
    const content = `Check this out: ![luffy](${url}) and also ${url}`;
    
    const prepared = await prepareDiscordMessageContent(content);
    
    // The text should be cleaned of both the markdown and the standalone URL
    // After cleaning "Check this out:  and also " -> normalized to "Check this out: and also"
    expect(prepared.text).toBe('Check this out: and also');
    expect(prepared.files).toHaveLength(1);
  });
});
