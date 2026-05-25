import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  resolveBindingResumeSessionId,
  resolveGeminiProjectDir,
  toGeminiProjectRelativePath,
} from '../src/daemon/gemini-project.js';

describe('Gemini project resolution', () => {
  it('uses the global .gemini folder when the extension is installed there', () => {
    const geminiDir = path.resolve(path.sep, 'home', 'user', '.gemini');
    const extensionDir = path.join(geminiDir, 'extensions', 'gemini-discord');

    expect(resolveGeminiProjectDir(extensionDir)).toBe(geminiDir);
  });

  it('falls back to the extension directory for local development', () => {
    const extensionDir = path.resolve(path.sep, 'workspace', 'gemini-discord');

    expect(resolveGeminiProjectDir(extensionDir)).toBe(extensionDir);
  });

  it('only resumes explicit stored session ids', () => {
    expect(resolveBindingResumeSessionId({ hasSession: true })).toBeNull();
    expect(resolveBindingResumeSessionId({ hasSession: true, lastSessionId: ' session-1 ' })).toBe('session-1');
  });

  it('builds attachment references relative to the Gemini project', () => {
    const projectDir = path.resolve(path.sep, 'home', 'user', '.gemini');
    const filePath = path.join(projectDir, 'extensions', 'gemini-discord', '.gemini-discord', 'bindings', 'global', 'briefing.md');

    expect(toGeminiProjectRelativePath(projectDir, filePath)).toBe(
      path.join('extensions', 'gemini-discord', '.gemini-discord', 'bindings', 'global', 'briefing.md'),
    );
  });
});
