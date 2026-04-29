import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConversationMemory, buildDiscordPrompt, buildSessionModePrompt, resolveSessionKey, extractHistoryImageUrls } from '../src/daemon/memory.js';

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
    authorName: 'User#0001',
    channelId: 'ch1',
    channelName: 'bridge-channel',
    guildId: 'g1',
    guildName: 'Test Guild',
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
    authorName: 'Assistant#0001',
    channelId: 'ch1',
    channelName: 'bridge-channel',
    guildId: 'g1',
    guildName: 'Test Guild',
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
    expect(snap[0].authorName).toBe('User#0001');
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
      channelName: 'agent-lab',
      guildId: 'g1',
      guildName: 'Test Guild',
      messageId: 'm3',
      replyToMessageId: 'r1',
      replyToAuthorName: 'Assistant#0001',
      trigger: 'reply',
    });

    expect(prompt).toContain('Use Discord-compatible Markdown.');
    expect(prompt).toContain('User#0001');
    expect(prompt).toContain('OtherAgent#9999');
    expect(prompt).toContain('Reply to Assistant#0001');
  });

  it('caps prompt history without dropping stored memory', () => {
    const mem = new ConversationMemory(tmpDir, 100);
    for (let index = 0; index < 30; index++) {
      mem.add('global', userMessage(`user-${index}: ${'x'.repeat(300)}`, { messageId: `u-${index}` }));
      mem.add('global', assistantMessage(`assistant-${index}: ${'y'.repeat(300)}`, { messageId: `a-${index}` }));
    }

    const prompt = mem.buildPrompt('global', {
      content: 'latest question',
      speakerKind: 'human',
      authorId: 'u1',
      authorName: 'User#0001',
      channelId: 'ch1',
      channelName: 'bridge-channel',
      guildId: 'g1',
      guildName: 'Test Guild',
      messageId: 'm-latest',
      trigger: 'channel',
    });

    expect(prompt).toContain('omitted');
    expect(prompt).toContain('assistant-29');
    expect(prompt).not.toContain('assistant-0');
    expect(mem.snapshot('global')).toHaveLength(60);
  });

  it('includes image attachment metadata in prompts', () => {
    const mem = new ConversationMemory(tmpDir, 10);

    const prompt = mem.buildPrompt('global', {
      content: '',
      attachments: [{ name: 'whiteboard.png', contentType: 'image/png', sizeBytes: 10240 }],
      speakerKind: 'human',
      authorId: 'u1',
      authorName: 'User#0001',
      channelId: 'ch1',
      channelName: 'bridge-channel',
      guildId: 'g1',
      guildName: 'Test Guild',
      messageId: 'm-image',
      trigger: 'channel',
    });

    // When content is empty but attachments exist, no placeholder text is shown
    expect(prompt).not.toContain('(no text provided)');
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
      channelName: 'agent-lab',
      messageId: 'm9',
    }));

    expect(mem.participants('global')).toEqual([
      { id: 'u1', name: 'User#0001', kind: 'human' },
      { id: 'bot', name: 'Assistant#0001', kind: 'assistant' },
      { id: 'agent-2', name: 'OtherAgent#9999', kind: 'agent' },
    ]);
    expect(mem.channels('global')).toEqual([
      { id: 'ch1', name: 'bridge-channel' },
      { id: 'ch2', name: 'agent-lab' },
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

    fs.writeFileSync(path.join(tmpDir, '.gemini-discord', 'memory.json'), '{broken json!!!', 'utf-8');

    const validData = JSON.stringify({
      version: 2,
      sessions: {
        global: [userMessage('recovered')],
      },
    });
    fs.writeFileSync(path.join(tmpDir, '.gemini-discord', 'memory.json.tmp'), validData, 'utf-8');

    const mem2 = new ConversationMemory(tmpDir, 10);
    const snap = mem2.snapshot('global');
    expect(snap).toHaveLength(1);
    expect(snap[0].content).toBe('recovered');
  });

  it('migrates legacy unversioned memory format', () => {
    fs.mkdirSync(path.join(tmpDir, '.gemini-discord'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.gemini-discord', 'memory.json'),
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
    fs.mkdirSync(path.join(tmpDir, '.gemini-discord'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.gemini-discord', 'memory.json'), 'garbage', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.gemini-discord', 'memory.json.tmp'), 'also garbage', 'utf-8');

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

describe('buildDiscordPrompt', () => {
  it('generates a well-structured prompt with runtime header', () => {
    const prompt = buildDiscordPrompt({
      incoming: {
        content: 'hey',
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: 'g1',
        guildName: 'Test Guild',
        messageId: 'm1',
        trigger: 'channel',
      },
    });

    expect(prompt).toContain('[Runtime: Discord group]');
    expect(prompt).toContain('Use Discord-compatible Markdown.');
    expect(prompt).toContain('The incoming message is from Discord.');
    expect(prompt).toContain('Do not call Discord send/reply tools for an ordinary response to the current message.');
    expect(prompt).toContain('[Message]');
    expect(prompt).toContain('hey');
  });

  it('includes background operations context when provided', () => {
    const prompt = buildDiscordPrompt({
      incoming: {
        content: 'what is running?',
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: 'g1',
        guildName: 'Test Guild',
        messageId: 'm-bg',
        trigger: 'channel',
      },
      backgroundContext: '[Background Operations]\n- Active cron jobs: 1.',
    });

    expect(prompt).toContain('[Background Operations]');
    expect(prompt).toContain('Active cron jobs: 1.');
  });

  it('generates DM prompt for non-guild context', () => {
    const prompt = buildDiscordPrompt({
      incoming: {
        content: 'search the web for the latest Gemini CLI changes',
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: null,
        guildName: null,
        messageId: 'm2',
        trigger: 'dm',
      },
    });

    expect(prompt).toContain('[Runtime: Discord direct]');
    expect(prompt).toContain('Use Discord-compatible Markdown.');
    expect(prompt).toContain('Use Discord tools only when the user asks for Discord actions');
    expect(prompt).toContain('[Message]');
  });
});

describe('extractHistoryImageUrls', () => {
  it('extracts image URLs from history messages', () => {
    const history = [
      userMessage('who is this?', {
        attachments: [
          { name: 'scarlet.png', contentType: 'image/png', sizeBytes: 10240, url: 'https://cdn.discordapp.com/attachments/1/2/scarlet.png' },
        ],
      }),
      assistantMessage('That is Scarlet from FF7'),
      userMessage('who is this?', {
        attachments: [
          { name: 'marcille.jpg', contentType: 'image/jpeg', sizeBytes: 20480, url: 'https://cdn.discordapp.com/attachments/1/3/marcille.jpg' },
        ],
      }),
    ];

    const urls = extractHistoryImageUrls(history);
    expect(urls).toEqual([
      'https://cdn.discordapp.com/attachments/1/2/scarlet.png',
      'https://cdn.discordapp.com/attachments/1/3/marcille.jpg',
    ]);
  });

  it('returns empty array for messages without attachments', () => {
    const history = [
      userMessage('hello'),
      assistantMessage('hi'),
    ];

    expect(extractHistoryImageUrls(history)).toEqual([]);
  });

  it('skips non-image attachments', () => {
    const history = [
      userMessage('here is my code', {
        attachments: [
          { name: 'code.ts', contentType: 'text/typescript', sizeBytes: 1024, url: 'https://cdn.discordapp.com/attachments/1/4/code.ts' },
        ],
      }),
    ];

    expect(extractHistoryImageUrls(history)).toEqual([]);
  });

  it('includes attachments with missing contentType (assumed image)', () => {
    const history = [
      userMessage('look at this', {
        attachments: [
          { name: 'unknown.bin', url: 'https://cdn.discordapp.com/attachments/1/5/unknown.bin' },
        ],
      }),
    ];

    expect(extractHistoryImageUrls(history)).toEqual([
      'https://cdn.discordapp.com/attachments/1/5/unknown.bin',
    ]);
  });
});

describe('image URLs in transcript history', () => {
  it('includes image URLs in history transcript entries', () => {
    const mem = new ConversationMemory(tmpDir, 10);
    mem.add('global', userMessage('who is this?', {
      attachments: [
        { name: 'scarlet.png', contentType: 'image/png', sizeBytes: 10240, url: 'https://cdn.discordapp.com/attachments/1/2/scarlet.png' },
      ],
    }));
    mem.add('global', assistantMessage('That is Scarlet from FF7'));

    const prompt = mem.buildPrompt('global', {
      content: 'who is this now?',
      attachments: [{ name: 'marcille.jpg', contentType: 'image/jpeg', sizeBytes: 20480, url: 'https://cdn.discordapp.com/attachments/1/3/marcille.jpg' }],
      speakerKind: 'human',
      authorId: 'u1',
      authorName: 'User#0001',
      channelId: 'ch1',
      channelName: 'bridge-channel',
      guildId: 'g1',
      guildName: 'Test Guild',
      messageId: 'm3',
      trigger: 'channel',
    });

    // The history section should contain the URL of the PREVIOUS image
    expect(prompt).toContain('https://cdn.discordapp.com/attachments/1/2/scarlet.png');
    // The assistant response should be in history
    expect(prompt).toContain('That is Scarlet from FF7');
    // The current message should have the new attachment
    expect(prompt).toContain('marcille.jpg');
  });
});

describe('buildSessionModePrompt', () => {
  it('includes runtime header and current message only', () => {
    const prompt = buildSessionModePrompt({
      incoming: {
        content: 'who is this?',
        attachments: [{ name: 'tifa.png', contentType: 'image/png', sizeBytes: 10240 }],
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: 'g1',
        guildName: 'Test Guild',
        messageId: 'm1',
        trigger: 'channel',
      },
    });

    // Has runtime header
    expect(prompt).toContain('[Runtime: Discord group]');
    expect(prompt).toContain('Use Discord-compatible Markdown.');
    expect(prompt).toContain('Your normal text response is sent back to the current Discord conversation.');
    // Has current message
    expect(prompt).toContain('[Message]');
    expect(prompt).toContain('who is this?');
    expect(prompt).toContain('tifa.png');
    // Does NOT have history replay sections (CLI session handles these)
    expect(prompt).not.toContain('[History]');
    expect(prompt).not.toContain('[Participants]');
  });

  it('includes live background operations context without replaying history', () => {
    const prompt = buildSessionModePrompt({
      incoming: {
        content: 'what background jobs are active?',
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: 'g1',
        guildName: 'Test Guild',
        messageId: 'm-bg-session',
        trigger: 'channel',
      },
      backgroundContext: '[Background Operations]\n- Active cron jobs: 2.',
    });

    expect(prompt).toContain('[Background Operations]');
    expect(prompt).toContain('Active cron jobs: 2.');
    expect(prompt).not.toContain('[History]');
    expect(prompt).not.toContain('[Participants]');
  });

  it('omits history even when history exists in memory', () => {
    // In session mode, the CLI session file IS the context.
    // buildSessionModePrompt should never include history.
    const prompt = buildSessionModePrompt({
      incoming: {
        content: 'latest question',
        speakerKind: 'human',
        authorId: 'u1',
        authorName: 'User#0001',
        channelId: 'ch1',
        channelName: 'bridge-channel',
        guildId: null,
        guildName: null,
        messageId: 'm2',
        trigger: 'dm',
      },
    });

    expect(prompt).toContain('[Runtime: Discord direct]');
    expect(prompt).toContain('latest question');
    expect(prompt).not.toContain('[History]');
    expect(prompt).not.toContain('[Participants]');
  });
});
