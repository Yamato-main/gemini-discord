import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConversationMemory, resolveSessionKey } from '../src/daemon/memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function userMessage(content: string, overrides: Record<string, unknown> = {}) {
  return {
    role: 'user' as const,
    content,
    speakerKind: 'human' as const,
    authorId: 'u1',
    authorName: 'Yamato#0001',
    channelId: 'ch1',
    channelName: 'yamato-samurai',
    guildId: 'g1',
    guildName: 'Sanctum',
    messageId: 'm1',
    createdAt: '2026-04-14T00:00:00.000Z',
    ...overrides,
  };
}

function assistantMessage(content: string, overrides: Record<string, unknown> = {}) {
  return {
    role: 'assistant' as const,
    content,
    speakerKind: 'assistant' as const,
    authorId: 'bot',
    authorName: 'Yamato-samurai#0001',
    channelId: 'ch1',
    channelName: 'yamato-samurai',
    guildId: 'g1',
    guildName: 'Sanctum',
    messageId: 'r1',
    createdAt: '2026-04-14T00:00:01.000Z',
    ...overrides,
  };
}

describe('ConversationMemory', () => {
  it('adds and retrieves rich messages', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('hello'));
    mem.add('global', assistantMessage('hi there'));

    const snap = mem.snapshot('global');
    expect(snap).toHaveLength(2);
    expect(snap[0].authorName).toBe('Yamato#0001');
    expect(snap[1].role).toBe('assistant');
  });

  it('trims history to configured length', () => {
    const mem = new ConversationMemory(tmpDir, 2);
    mem.add('global', userMessage('msg1', { messageId: 'm1' }));
    mem.add('global', assistantMessage('resp1', { messageId: 'r1' }));
    mem.add('global', userMessage('msg2', { messageId: 'm2' }));
    mem.add('global', assistantMessage('resp2', { messageId: 'r2' }));
    mem.add('global', userMessage('msg3', { messageId: 'm3' }));
    mem.add('global', assistantMessage('resp3', { messageId: 'r3' }));

    const snap = mem.snapshot('global');
    expect(snap).toHaveLength(4);
    expect(snap[0].content).toBe('msg2');
  });

  it('truncates content to 2000 chars', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('x'.repeat(5000)));

    const snap = mem.snapshot('global');
    expect(snap[0].content).toHaveLength(2000);
  });

  it('resets session history', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('hello'));
    mem.reset('global');

    expect(mem.snapshot('global')).toHaveLength(0);
  });

  it('builds prompt with speaker and channel context', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('hello'));
    mem.add('global', assistantMessage('hi'));

    const prompt = mem.buildPrompt('global', {
      content: 'how are you',
      speakerKind: 'agent',
      authorId: 'agent-2',
      authorName: 'OtherAgent#9999',
      channelId: 'ch2',
      channelName: 'multi-agent-lab',
      guildId: 'g1',
      guildName: 'Sanctum',
      messageId: 'm3',
      replyToMessageId: 'r1',
      trigger: 'reply',
    });

    expect(prompt).toContain('You are currently manifesting within a Discord server');
    expect(prompt).toContain('Yamato#0001: hello');
    expect(prompt).toContain('OtherAgent#9999: how are you');
  });

  it('includes image attachment metadata in prompts', () => {
    const mem = new ConversationMemory(tmpDir, 10);

    const prompt = mem.buildPrompt('global', {
      content: '',
      attachments: [{ name: 'whiteboard.png', contentType: 'image/png', sizeBytes: 10240 }],
      speakerKind: 'human',
      authorId: 'u1',
      authorName: 'Yamato#0001',
      channelId: 'ch1',
      channelName: 'yamato-samurai',
      guildId: 'g1',
      guildName: 'Sanctum',
      messageId: 'm-image',
      trigger: 'channel',
    });

    expect(prompt).toContain('Yamato#0001: (no text provided)');
    expect(prompt).toContain('whiteboard.png');
    expect(prompt).toContain('image/png');
  });

  it('returns participants and channels for a session', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('hello'));
    mem.add('global', assistantMessage('hi'));
    mem.add('global', userMessage('ping', {
      authorId: 'agent-2',
      authorName: 'OtherAgent#9999',
      speakerKind: 'agent',
      channelId: 'ch2',
      channelName: 'multi-agent-lab',
      messageId: 'm9',
    }));

    expect(mem.participants('global')).toEqual([
      { id: 'u1', name: 'Yamato#0001', kind: 'human' },
      { id: 'bot', name: 'Yamato-samurai#0001', kind: 'assistant' },
      { id: 'agent-2', name: 'OtherAgent#9999', kind: 'agent' },
    ]);
    expect(mem.channels('global')).toEqual([
      { id: 'ch1', name: 'yamato-samurai' },
      { id: 'ch2', name: 'multi-agent-lab' },
    ]);
  });

  it('persists to disk and recovers', () => {
    const mem1 = new ConversationMemory(tmpDir, 10);
    mem1.add('global', userMessage('persistent'));
    mem1.add('global', assistantMessage('data'));
    mem1.flush();

    const mem2 = new ConversationMemory(tmpDir, 10);
    const snap = mem2.snapshot('global');
    expect(snap).toHaveLength(2);
    expect(snap[0].content).toBe('persistent');
    expect(snap[1].content).toBe('data');
  });

  it('recovers from .tmp file when primary is corrupted', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('saved'));
    mem.flush();

    fs.writeFileSync(path.join(tmpDir, '.memory.json'), '{broken json!!!', 'utf-8');

    const validData = JSON.stringify({
      version: 2,
      sessions: {
        global: [userMessage('recovered')],
      },
    });
    fs.writeFileSync(path.join(tmpDir, '.memory.json.tmp'), validData, 'utf-8');

    const mem2 = new ConversationMemory(tmpDir, 10);
    const snap = mem2.snapshot('global');
    expect(snap).toHaveLength(1);
    expect(snap[0].content).toBe('recovered');
  });

  it('migrates legacy unversioned memory format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.memory.json'),
      JSON.stringify({
        global: [{ role: 'user', content: 'legacy hello' }],
      }),
      'utf-8',
    );

    const mem = new ConversationMemory(tmpDir, 10);
    expect(mem.snapshot('global')[0].content).toBe('legacy hello');
    expect(mem.snapshot('global')[0].speakerKind).toBe('human');
  });

  it('starts empty when both files are corrupted', () => {
    fs.writeFileSync(path.join(tmpDir, '.memory.json'), 'garbage', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.memory.json.tmp'), 'also garbage', 'utf-8');

    const mem = new ConversationMemory(tmpDir, 10);
    expect(mem.snapshot('global')).toEqual([]);
  });
});

describe('resolveSessionKey', () => {
  it('returns global scope by default', () => {
    expect(resolveSessionKey('global', 'ch1')).toBe('global');
  });

  it('returns channel-scoped keys when configured', () => {
    expect(resolveSessionKey('channel', 'ch1')).toBe('channel:ch1');
  });
});
