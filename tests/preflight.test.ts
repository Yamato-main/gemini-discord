import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  return {
    ...actual,
    createConnection: createConnectionMock,
  };
});

import { checkPortInUse } from '../src/daemon/preflight.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkPortInUse', () => {
  it('returns true when the port accepts a connection', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('connect');

    await expect(resultPromise).resolves.toBe(true);
    expect(createConnectionMock).toHaveBeenCalledWith({ host: '127.0.0.1', port: 18790 });
    expect(socket.setTimeout).toHaveBeenCalledWith(750);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns false when localhost refuses the connection', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('error', { code: 'ECONNREFUSED' });

    await expect(resultPromise).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns false when sandboxed localhost probes are blocked', async () => {
    const socket = createFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const resultPromise = checkPortInUse(18790);
    socket.emit('error', { code: 'EPERM' });

    await expect(resultPromise).resolves.toBe(false);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });
});

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  socket.setTimeout = vi.fn();
  socket.destroy = vi.fn();
  return socket;
}
