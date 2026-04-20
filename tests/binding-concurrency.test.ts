import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// We will mock mkdir because it's the first thing called in ensureGeminiBindingWorkspace
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    mkdir: vi.fn(original.mkdir),
  };
});

import {
  ensureGeminiBindingWorkspace,
} from '../src/daemon/binding.js';

describe('binding workspace concurrency', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-concurrency-'));
    fs.writeFileSync(path.join(tmpDir, '.geminiignore'), 'tmp/', 'utf-8');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serializes concurrent ensureGeminiBindingWorkspace calls for the same key', async () => {
    let activeCalls = 0;
    let maxConcurrentCalls = 0;

    const mockedMkdir = vi.mocked(fsPromises.mkdir);
    const originalMkdir = mockedMkdir.getMockImplementation()!;
    mockedMkdir.mockImplementation(async (path: any, options: any) => {
      activeCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      await new Promise(resolve => setTimeout(resolve, 50));
      // Call the original implementation (which we got from importOriginal in vi.mock)
      // but we need to access it correctly. Actually, in vi.mock we can capture it.
      activeCalls--;
      return fs.mkdirSync(path, options); // Using sync for simplicity in mock implementation
    });

    const bindingKey = 'guild:g1';
    
    // Fire two calls concurrently
    await Promise.all([
      ensureGeminiBindingWorkspace(tmpDir, bindingKey),
      ensureGeminiBindingWorkspace(tmpDir, bindingKey)
    ]);

    // WITHOUT locking, maxConcurrentCalls would be 2
    // WITH locking, maxConcurrentCalls should be 1
    expect(maxConcurrentCalls).toBe(1);
  });

  it('allows concurrent calls for DIFFERENT keys', async () => {
    let activeCalls = 0;
    let maxConcurrentCalls = 0;

    const mockedMkdir = vi.mocked(fsPromises.mkdir);
    mockedMkdir.mockImplementation(async (path: any, options: any) => {
      activeCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      await new Promise(resolve => setTimeout(resolve, 50));
      activeCalls--;
      return fs.mkdirSync(path, options);
    });

    // Fire two calls for DIFFERENT keys
    await Promise.all([
      ensureGeminiBindingWorkspace(tmpDir, 'guild:g1'),
      ensureGeminiBindingWorkspace(tmpDir, 'guild:g2')
    ]);

    // DIFFERENT keys should NOT be blocked by each other
    expect(maxConcurrentCalls).toBe(2);
  });
});
