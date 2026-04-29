import * as path from 'node:path';
import type { GeminiBindingState } from './binding.js';

export function resolveGeminiProjectDir(extensionDir: string): string {
  const resolved = path.resolve(extensionDir);
  const parts = resolved.split(path.sep);

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === '.gemini') {
      const prefix = parts.slice(0, index + 1).join(path.sep);
      return prefix || path.sep;
    }
  }

  return resolved;
}

export function resolveBindingResumeSessionId(state: GeminiBindingState): string | null {
  const sessionId = state.lastSessionId?.trim();
  return sessionId ? sessionId : null;
}

export function toGeminiProjectRelativePath(projectDir: string, filePath: string): string {
  return path.relative(projectDir, filePath);
}
