import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { log } from './log.js';

export const DEFAULT_TMP_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TMP_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface AttachmentCleanupResult {
  checked: number;
  removed: number;
  root: string;
}

export async function cleanupStaleTmpAttachments(
  extensionDir: string,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<AttachmentCleanupResult> {
  const root = path.join(extensionDir, '.tmp-attachments');
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_TMP_ATTACHMENT_TTL_MS;
  const cutoffMs = nowMs - ttlMs;

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { checked: 0, removed: 0, root };
    }
    throw err;
  }

  let checked = 0;
  let removed = 0;
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    checked++;

    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      continue;
    }

    if (stat.mtimeMs > cutoffMs) {
      continue;
    }

    await fs.rm(target, { recursive: true, force: true });
    removed++;
  }

  return { checked, removed, root };
}

export function startTmpAttachmentCleanup(
  extensionDir: string,
  options: { ttlMs?: number; intervalMs?: number } = {},
): NodeJS.Timeout {
  const ttlMs = options.ttlMs ?? DEFAULT_TMP_ATTACHMENT_TTL_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_TMP_ATTACHMENT_CLEANUP_INTERVAL_MS;

  const run = (): void => {
    cleanupStaleTmpAttachments(extensionDir, { ttlMs })
      .then((result) => {
        if (result.removed > 0) {
          log.info('Removed stale temporary Discord attachments', {
            count: result.removed,
            checked: result.checked,
            root: result.root,
          });
        }
      })
      .catch((err) => {
        log.warn('Temporary Discord attachment cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
