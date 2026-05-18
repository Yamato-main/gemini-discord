import { describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveSendChannelId, startControlApi, type DaemonState } from '../src/daemon/api.js';
import { createConfig } from './test-utils/factories.js';

describe('resolveSendChannelId', () => {
  it('uses an explicit channel id when provided', () => {
    expect(resolveSendChannelId('server-channel')).toBe('server-channel');
  });

  it('does not invent a target when channel id is omitted', () => {
    expect(resolveSendChannelId('')).toBe('');
  });
});

describe('control API Discord role gates', () => {
  it('does not expose status without re-resolvable Discord role context', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-permissions-'));
    const config = createConfig({ daemonPort: 0 });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: null,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/status`);

      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('re-resolves propagated role headers from configured Discord sender id', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-permissions-'));
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: null,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: {
          'X-Gemini-Discord-Role': 'BOSS',
          'X-Gemini-Discord-Sender-Id': '222222222222222222',
          'X-Gemini-Discord-Sender-Label': 'Guest#0001',
        },
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects sends without an explicit channel target', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-send-'));
    const config = createConfig({
      daemonPort: 0,
      discordBossUserId: '111111111111111111',
      discordChannelId: 'primary-channel',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: { add: vi.fn() } as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: null,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/send`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({ content: 'hello' }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'No proven Discord target is available. Provide channel_id or channel_name explicitly.',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('control API moderation', () => {
  it('times out a guild member for an authorized Discord request', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-moderation-'));
    const timeout = vi.fn().mockResolvedValue({});
    const client = createModerationClient({ member: { timeout, kick: vi.fn() } });
    const config = createConfig({
      daemonPort: 0,
      discordServerId: 'guild-1',
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/moderation`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          action: 'timeout',
          user_id: '222222222222222222',
          duration_minutes: 15,
          reason: 'cooldown',
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, action: 'timeout', user_id: '222222222222222222', guild_id: 'guild-1' });
      expect(timeout).toHaveBeenCalledWith(15 * 60_000, 'cooldown');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('kicks a guild member for an authorized Discord request', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-moderation-'));
    const kick = vi.fn().mockResolvedValue({});
    const client = createModerationClient({ member: { timeout: vi.fn(), kick } });
    const config = createConfig({
      daemonPort: 0,
      discordServerId: 'guild-1',
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/moderation`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          action: 'kick',
          user_id: '222222222222222222',
          reason: 'rule violation',
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, action: 'kick' });
      expect(kick).toHaveBeenCalledWith('rule violation');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('denies guest moderation requests before touching Discord', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-moderation-'));
    const kick = vi.fn().mockResolvedValue({});
    const client = createModerationClient({ member: { timeout: vi.fn(), kick } });
    const config = createConfig({
      daemonPort: 0,
      discordServerId: 'guild-1',
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/moderation`, {
        method: 'POST',
        headers: guestHeaders(config.daemonApiToken),
        body: JSON.stringify({
          action: 'kick',
          user_id: '222222222222222222',
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'I can only do that with approval from the authorized Discord user.' });
      expect(kick).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses to moderate the configured authorized Discord user', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-moderation-'));
    const kick = vi.fn().mockResolvedValue({});
    const client = createModerationClient({ member: { timeout: vi.fn(), kick } });
    const config = createConfig({
      daemonPort: 0,
      discordServerId: 'guild-1',
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/moderation`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          action: 'kick',
          user_id: '111111111111111111',
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'Refusing to moderate the configured authorized Discord user' });
      expect(kick).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('requires moderation targets to be stable numeric Discord user ids', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-api-moderation-'));
    const kick = vi.fn().mockResolvedValue({});
    const client = createModerationClient({ member: { timeout: vi.fn(), kick } });
    const config = createConfig({
      daemonPort: 0,
      discordServerId: 'guild-1',
      discordBossUserId: '111111111111111111',
    });
    const server = startControlApi({
      config,
      state: createState(),
      memory: {} as any,
      queue: { depth: () => 0 } as any,
      extensionDir: tmpDir,
      client: client as any,
      isShuttingDown: () => false,
      shutdown: async () => {},
    });

    try {
      await once(server, 'listening');
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/moderation`, {
        method: 'POST',
        headers: bossHeaders(config.daemonApiToken),
        body: JSON.stringify({
          action: 'kick',
          user_id: '<@222222222222222222>',
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('stable numeric Discord user ID'),
      });
      expect(kick).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function createState(): DaemonState {
  return {
    status: 'ready',
    startedAt: new Date(0).toISOString(),
    geminiReachable: true,
    geminiVersion: 'test',
    messagesHandled: 0,
    lastMessageAt: null,
    lastError: null,
    exchangeLog: [],
  };
}

function createModerationClient({ member }: { member: { timeout: ReturnType<typeof vi.fn>; kick: ReturnType<typeof vi.fn> } }) {
  return {
    user: { id: 'bot-user', tag: 'Bot#0001' },
    ws: { ping: 0 },
    guilds: {
      fetch: vi.fn().mockResolvedValue({
        members: {
          fetch: vi.fn().mockResolvedValue(member),
        },
      }),
    },
  };
}

function bossHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Gemini-Discord-Role': 'BOSS',
    'X-Gemini-Discord-Sender-Id': '111111111111111111',
    'X-Gemini-Discord-Sender-Label': 'Authorized#0001',
  };
}

function guestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Gemini-Discord-Role': 'GUEST',
    'X-Gemini-Discord-Sender-Id': '222222222222222222',
    'X-Gemini-Discord-Sender-Label': 'Guest#0001',
  };
}
