import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listDmPairings, resolveDmPairingKey, touchDmPairing } from '../src/daemon/dm-pairing.js';

describe('dm pairing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-discord-dm-pair-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores a stable DM pairing by user id', () => {
    const first = touchDmPairing(tmpDir, 'owner-1', 'dm-channel-1');
    const second = touchDmPairing(tmpDir, 'owner-1', 'dm-channel-2');

    expect(resolveDmPairingKey('owner-1')).toBe('dm:owner-1');
    expect(first.userId).toBe('owner-1');
    expect(second.channelId).toBe('dm-channel-2');
    expect(listDmPairings(tmpDir)).toMatchObject([
      {
        userId: 'owner-1',
        channelId: 'dm-channel-2',
      },
    ]);
  });
});
