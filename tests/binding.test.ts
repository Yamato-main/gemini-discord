import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureGeminiBindingWorkspace,
  loadGeminiBindingState,
  resolveGeminiBindingKey,
  saveGeminiBindingState,
} from '../src/daemon/binding.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-binding-'));
  fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Persona', 'utf-8');
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

  it('falls back to the DM channel id outside guilds', () => {
    expect(resolveGeminiBindingKey('server', { guildId: null, channelId: 'dm-1' })).toBe('channel:dm-1');
  });
});

describe('binding workspace state', () => {
  it('creates workspace folders and syncs project files', () => {
    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'channel:c1');

    expect(fs.existsSync(workspace.bindingDir)).toBe(true);
    expect(fs.existsSync(workspace.attachmentsDir)).toBe(true);
    expect(fs.existsSync(path.join(workspace.bindingDir, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace.bindingDir, '.geminiignore'))).toBe(true);
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
    expect(loadGeminiBindingState(workspace.bindingDir)).toEqual({
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

    expect(loadGeminiBindingState(workspace.bindingDir)).toEqual({
      hasSession: true,
      lastSessionId: 'session-123',
    });
  });
});
