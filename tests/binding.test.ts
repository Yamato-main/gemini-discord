import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ensureGeminiBindingWorkspace,
  loadBindingState,
  resolveGeminiBindingKey,
  saveBindingState,
} from '../src/daemon/binding.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-binding-'));
  fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Persona', 'utf-8');
  fs.writeFileSync(path.join(tmpDir, '.geminiignore'), 'tmp/', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveGeminiBindingKey', () => {
  const context = {
    guildId: 'g1',
    guildName: 'Sanctum',
    channelId: 'c1',
    channelName: 'boardroom',
    authorId: 'u1',
  };

  it('binds guild traffic by server by default', () => {
    expect(resolveGeminiBindingKey('server', context)).toBe('guild:g1');
  });

  it('can bind by channel', () => {
    expect(resolveGeminiBindingKey('channel', context)).toBe('channel:c1');
  });

  it('can bind globally', () => {
    expect(resolveGeminiBindingKey('global', context)).toBe('global');
  });

  it('keeps DMs separate from guild bindings', () => {
    expect(resolveGeminiBindingKey('server', { ...context, guildId: null })).toBe('dm:u1');
  });
});

describe('binding workspace state', () => {
  it('creates workspace folders and syncs project files', () => {
    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'guild:g1');
    expect(fs.existsSync(workspace.bindingDir)).toBe(true);
    expect(fs.existsSync(path.join(workspace.bindingDir, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspace.bindingDir, '.geminiignore'))).toBe(true);
  });

  it('persists binding session state', () => {
    const workspace = ensureGeminiBindingWorkspace(tmpDir, 'guild:g1');
    saveBindingState(workspace.bindingDir, { hasSession: true, lastSessionId: 'session-123' });

    expect(loadBindingState(workspace.bindingDir)).toEqual({
      hasSession: true,
      lastSessionId: 'session-123',
    });
  });
});
