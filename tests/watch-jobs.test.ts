import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runtimeStore } from '../src/daemon/runtime.js';
import { createConfig } from './test-utils/factories.js';

const sendDiscordMessageMock = vi.hoisted(() => vi.fn(async () => ['discord-msg-1']));

vi.mock('../src/daemon/sender.js', () => ({
  sendDiscordMessage: sendDiscordMessageMock,
}));

import {
  initWatchJobs,
  shutdownWatchJobs,
  scheduleWatchJob,
  listWatchJobs,
  deleteWatchJob,
  runWatchCycleNow,
} from '../src/daemon/watch-jobs.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-watch-'));
  fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Persona\n', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, '.geminiignore'), 'discord-attachments/\n', 'utf-8');
  sendDiscordMessageMock.mockClear();
  runtimeStore.client = null;
  runtimeStore.cliPool = null;
  runtimeStore.geminiSemaphore = null;
  runtimeStore.lastInteractiveMessageAt = null;
});

afterEach(() => {
  shutdownWatchJobs();
  runtimeStore.client = null;
  runtimeStore.cliPool = null;
  runtimeStore.geminiSemaphore = null;
  runtimeStore.lastInteractiveMessageAt = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('watch jobs', () => {
  it('collects until the due time without waking Gemini early', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {
        threads: [
          {
            no: 777,
            sub: 'One Piece chatter',
            com: 'Spoilers are moving.',
            replies: 12,
            images: 1,
            last_modified: 1710000000,
          },
        ],
      },
    ]), { status: 200 })) as typeof fetch);

    const config = createConfig();
    initWatchJobs(config, tmpDir);

    const cliPoolMock = { send: vi.fn(async () => 'Hey, Yamato, report ready.') };
    runtimeStore.cliPool = cliPoolMock as never;
    runtimeStore.client = {
      channels: {
        fetch: vi.fn(async () => ({
          id: 'reporting',
          isTextBased: () => true,
          send: vi.fn(),
        })),
      },
    } as never;
    runtimeStore.geminiSemaphore = {
      inFlight: 0,
      waiting: 0,
      acquireWithTimeout: vi.fn(async () => {}),
      release: vi.fn(),
    } as never;

    scheduleWatchJob({
      topic: 'One Piece spoiler thread',
      board: 'a',
      keywords: ['one piece'],
      channelId: 'reporting',
      authorId: 'owner-1',
      reportInMinutes: 30,
      pollEveryMinutes: 5,
    });

    await runWatchCycleNow(config, tmpDir);

    expect(cliPoolMock.send).not.toHaveBeenCalled();
    expect(sendDiscordMessageMock).not.toHaveBeenCalled();
    expect(listWatchJobs()[0]?.status).toBe('collecting');
  });

  it('wakes Gemini and posts a report once the watch is due', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      {
        threads: [
          {
            no: 888,
            sub: 'One Piece spoiler thread',
            com: 'The leaks are heating up fast.',
            replies: 44,
            images: 3,
            last_modified: 1710000000,
          },
        ],
      },
    ]), { status: 200 })) as typeof fetch);

    const config = createConfig();
    initWatchJobs(config, tmpDir);

    const cliPoolMock = { send: vi.fn(async () => 'Hey, Yamato, the One Piece spoiler thread kept moving and the discussion stayed leak-heavy.') };
    runtimeStore.cliPool = cliPoolMock as never;
    runtimeStore.client = {
      channels: {
        fetch: vi.fn(async () => ({
          id: 'reporting',
          isTextBased: () => true,
          send: vi.fn(),
        })),
      },
    } as never;
    runtimeStore.geminiSemaphore = {
      inFlight: 0,
      waiting: 0,
      acquireWithTimeout: vi.fn(async () => {}),
      release: vi.fn(),
    } as never;

    const job = scheduleWatchJob({
      topic: 'One Piece spoiler thread',
      board: 'a',
      keywords: ['one piece'],
      channelId: 'reporting',
      authorId: 'owner-1',
      reportInMinutes: 0,
      pollEveryMinutes: 1,
    });

    await runWatchCycleNow(config, tmpDir);

    expect(cliPoolMock.send).toHaveBeenCalledOnce();
    expect(sendDiscordMessageMock).toHaveBeenCalledOnce();
    expect(listWatchJobs()[0]?.status).toBe('completed');
    expect(fs.existsSync(path.join(tmpDir, '.agent', 'watch-jobs', job.id, 'timeline.jsonl'))).toBe(true);
    expect(deleteWatchJob(job.id)).toBe(true);
  });
});
