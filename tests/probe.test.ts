import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDiscordGateway } from '../src/daemon/probe.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeDiscordGateway', () => {
  it('succeeds and identifies bot and intents when fully authorized', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/users/@me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: '123456', username: 'TestBot', discriminator: '0' }),
        });
      }
      if (url.includes('/oauth2/applications/@me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            flags: (1 << 14) | (1 << 18), // GATEWAY_GUILD_MEMBERS and GATEWAY_MESSAGE_CONTENT
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDiscordGateway('valid-token');

    expect(result).toEqual({
      ok: true,
      botId: '123456',
      botTag: 'TestBot',
      hasMessageContent: true,
      hasGuildMembers: true,
      error: null,
    });
  });

  it('detects missing Message Content intent', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/users/@me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: '123456', username: 'TestBot', discriminator: '1234' }),
        });
      }
      if (url.includes('/oauth2/applications/@me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            flags: 1 << 15, // Only GATEWAY_GUILD_MEMBERS_LIMITED (Guild members is true, but message content is false)
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDiscordGateway('valid-token');

    expect(result).toEqual({
      ok: true,
      botId: '123456',
      botTag: 'TestBot#1234',
      hasMessageContent: false,
      hasGuildMembers: true,
      error: null,
    });
  });

  it('returns false for invalid token', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/users/@me')) {
        return Promise.resolve({
          ok: false,
          status: 401,
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDiscordGateway('invalid-token');

    expect(result).toEqual({
      ok: false,
      botId: null,
      botTag: null,
      hasMessageContent: false,
      hasGuildMembers: false,
      error: 'Invalid or missing bot token',
    });
  });

  it('fails gracefully on API errors', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      return Promise.reject(new Error('Network failure'));
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await probeDiscordGateway('valid-token');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network failure');
  });
});
