import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/shared/types.js';
import { ensureRuntimePaths } from '../src/shared/runtime-paths.js';

const requestMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const openSyncMock = vi.hoisted(() => vi.fn(() => 1));

vi.mock('node:http', () => ({
  request: requestMock,
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: openSyncMock,
  };
});

import { resolveActivePort, restartDaemon } from '../src/shared/daemon-runtime.js';

interface FakeDaemonState {
  healthy: boolean;
  startedAt: string;
  shutdownDelayMs: number;
  stubborn: boolean;
  nextStartId: number;
}

let state: FakeDaemonState;
let config: Config;

beforeEach(() => {
  state = {
    healthy: true,
    startedAt: 'start-1',
    shutdownDelayMs: 20,
    stubborn: false,
    nextStartId: 2,
  };
  config = createConfig();

  requestMock.mockReset();
  spawnMock.mockReset();
  openSyncMock.mockClear();

  requestMock.mockImplementation((options: { path?: string; method?: string }, callback?: (res: EventEmitter & { statusCode: number; resume: () => void }) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };

    req.end = () => {
      queueMicrotask(() => {
        if (!callback) {
          return;
        }

        const path = options.path ?? '/';
        if (path === '/health') {
          callback(createResponse(state.healthy ? 200 : 503));
          return;
        }

        if (path === '/status') {
          callback(createResponse(state.healthy ? 200 : 503, state.healthy ? JSON.stringify({ startedAt: state.startedAt }) : undefined));
          return;
        }

        if (path === '/shutdown') {
          callback(createResponse(200, JSON.stringify({ ok: true })));
          if (!state.stubborn) {
            setTimeout(() => {
              state.healthy = false;
            }, state.shutdownDelayMs);
          }
          return;
        }

        callback(createResponse(404, JSON.stringify({ error: 'Not found' })));
      });
    };

    req.destroy = () => {};
    return req;
  });

  spawnMock.mockImplementation(() => {
    setTimeout(() => {
      state.healthy = true;
      state.startedAt = `start-${state.nextStartId++}`;
    }, 20);

    return {
      unref() {},
    };
  });
});

afterEach(() => {
  vi.clearAllTimers();
});

describe('restartDaemon', () => {
  it('restarts a healthy daemon and observes a new start time', async () => {
    await restartDaemon(config, '/tmp/gemini-discord-test', {
      stopTimeoutMs: 500,
      pollIntervalMs: 10,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(state.healthy).toBe(true);
    expect(state.startedAt).toBe('start-2');
  });

  it('fails if the current daemon acknowledges shutdown but never stops', async () => {
    state.stubborn = true;

    await expect(
      restartDaemon(config, '/tmp/gemini-discord-test', {
        stopTimeoutMs: 100,
        pollIntervalMs: 10,
      }),
    ).rejects.toThrow('daemon_failed_to_stop');

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('resolveActivePort', () => {
  it('uses a valid discovered daemon port', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-runtime-'));
    const paths = ensureRuntimePaths(tmpDir);

    try {
      fs.writeFileSync(paths.daemonPortFile, '18791');

      await expect(resolveActivePort(config, tmpDir)).resolves.toBe(18791);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back to config when the discovered daemon port is invalid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-runtime-'));
    const paths = ensureRuntimePaths(tmpDir);

    try {
      fs.writeFileSync(paths.daemonPortFile, '18791 trailing-data');

      await expect(resolveActivePort(config, tmpDir)).resolves.toBe(config.daemonPort);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function createConfig(): Config {
  return {
    discordBotToken: 'test-token',
    discordChannelId: 'channel-1',
    discordServerId: '',
    discordServerName: '',
    discordBossUserId: '111111111111111111',
    ownerIds: ['owner-1'],
    discordAdminId: 'owner-1',
    allowedChannelIds: ['channel-1'],
    allowedUserIds: ['owner-1'],
    allowedAgentIds: [],
    daemonApiToken: 'daemon-token',
    discordPrefix: '!',
    discordResetCmd: '!reset',
    daemonPort: 18790,
    geminiPath: 'gemini',
    geminiModel: 'gemini-3.1-pro-preview',
    geminiTimeoutMs: 5_000,
    geminiMaxConcurrent: 3,
    conversationHistoryLength: 10,
    promptHistoryMessageLimit: 16,
    promptHistoryCharBudget: 12000,
    streaming: true,
    queueMaxDepth: 20,
    enableDMs: true,
    enableGuests: false,
    requireMention: false,
    respondToReplies: true,
    memoryScope: 'global',
    autoStartDaemon: true,
    useGeminiCliSessions: true,
    geminiSessionBindingScope: 'server',
    cliIdleTimeoutMs: 300000,
    setupValidationPending: false,
  };
}

function createResponse(statusCode: number, body?: string): EventEmitter & { statusCode: number; resume: () => void } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
  res.statusCode = statusCode;
  res.resume = () => {};

  queueMicrotask(() => {
    if (body) {
      res.emit('data', Buffer.from(body));
    }
    res.emit('end');
  });

  return res;
}
