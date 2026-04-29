import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureGeminiBindingWorkspace,
  cleanupLegacyBindingContextFiles,
  loadGeminiBindingState,
  resolveGeminiBindingKey,
  saveGeminiBindingState,
} from '../src/daemon/binding.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-binding-'));
  fs.writeFileSync(path.join(tmpDir, '.geminiignore'), 'discord-attachments/', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveGeminiBindingKey', () => {
  it('binds guild traffic by channel when channel scope is configured', () => {
    expect(resolveGeminiBindingKey('channel', { guildId: 'g1', channelId: 'c1' })).toBe('channel:c1');
  });

  it('binds guild traffic by server when server scope is configured', () => {
    expect(resolveGeminiBindingKey('server', { guildId: 'g1', channelId: 'c1' })).toBe('guild:g1');
  });

  it('binds DMs by paired user id outside guilds', () => {
    expect(resolveGeminiBindingKey('server', { guildId: null, channelId: 'dm-1', dmUserId: 'u1' })).toBe('dm:u1');
    expect(resolveGeminiBindingKey('channel', { guildId: null, channelId: 'dm-1', dmUserId: 'u1' })).toBe('dm:u1');
  });
});

describe('binding workspace state', () => {
  it('creates workspace folders and syncs project files', () => {
    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'channel:c1');

    expect(fs.existsSync(workspace.bindingDir)).toBe(true);
    expect(fs.existsSync(workspace.attachmentsDir)).toBe(true);
    expect(fs.existsSync(path.join(workspace.bindingDir, 'GEMINI.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspace.bindingDir, '.geminiignore'))).toBe(true);
  });

  it('removes legacy per-binding Gemini context files', () => {
    const legacyDir = path.join(tmpDir, '.gemini-discord', 'bindings', 'channel-c1');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'GEMINI.md'), '# old context', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'Gemini.md'), '# old context', 'utf-8');
    fs.writeFileSync(path.join(legacyDir, 'gemini.md'), '# old context', 'utf-8');

    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'channel:c1');

    expect(fs.existsSync(path.join(workspace.bindingDir, 'GEMINI.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspace.bindingDir, 'Gemini.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspace.bindingDir, 'gemini.md'))).toBe(false);
  });

  it('cleans legacy context files across existing binding folders', () => {
    const first = path.join(tmpDir, '.gemini-discord', 'bindings', 'channel-c1');
    const second = path.join(tmpDir, '.gemini-discord', 'bindings', 'dm-u1');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(first, 'GEMINI.md'), '# old context', 'utf-8');
    fs.writeFileSync(path.join(second, 'Gemini.md'), '# old context', 'utf-8');

    expect(cleanupLegacyBindingContextFiles(tmpDir)).toBe(2);
    expect(fs.existsSync(path.join(first, 'GEMINI.md'))).toBe(false);
    expect(fs.existsSync(path.join(second, 'Gemini.md'))).toBe(false);
  });

  it('migrates legacy binding folders without losing existing sessions', () => {
    const legacyDir = path.join(tmpDir, '.gemini-discord', 'bindings', 'channel:c1');
    fs.mkdirSync(path.join(legacyDir, 'discord-attachments'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, '.binding-state.json'), JSON.stringify({
      hasSession: true,
      lastSessionId: 'session-123',
    }));

    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'channel:c1');

    expect(path.basename(workspace.bindingDir)).toBe('channel-c1');
    expect(fs.existsSync(workspace.bindingDir)).toBe(true);
    expect(loadGeminiBindingState(workspace.bindingDir)).toMatchObject({
      hasSession: true,
      lastSessionId: 'session-123',
    });
  });

  it('persists whether a channel already has a resumable Gemini session', () => {
    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'channel:c1');

    saveGeminiBindingState(workspace.bindingDir, {
      hasSession: true,
      lastSessionId: 'session-123',
    });

    expect(loadGeminiBindingState(workspace.bindingDir)).toMatchObject({
      hasSession: true,
      lastSessionId: 'session-123',
    });
  });
});
