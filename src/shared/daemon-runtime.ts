import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Config } from './types.js';

let startupPromise: Promise<void> | null = null;
const HEALTH_POLL_MS = 500;
const STOP_TIMEOUT_MS = 45_000;

interface RuntimeWaitOptions {
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
}

export async function ensureDaemonRunning(config: Config, extensionDir: string): Promise<void> {
  if (await isDaemonHealthy(config.daemonPort)) {
    return;
  }

  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = startDaemonProcess(config, extensionDir).finally(() => {
    startupPromise = null;
  });

  return startupPromise;
}

export async function shutdownDaemon(config: Config): Promise<void> {
  if (!(await isDaemonHealthy(config.daemonPort))) {
    return;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: config.daemonPort,
        path: '/shutdown',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.daemonApiToken}`,
          'Content-Length': 0,
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`shutdown_failed_status_${res.statusCode}`));
        }
      },
    );

    req.on('error', (err) => reject(err));
    req.end();
  });
}

export async function restartDaemon(
  config: Config,
  extensionDir: string,
  options: RuntimeWaitOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? HEALTH_POLL_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const wasHealthy = await isDaemonHealthy(config.daemonPort);
  const previousStartedAt = wasHealthy ? await getDaemonStartedAt(config) : null;

  if (wasHealthy) {
    await shutdownDaemon(config);

    const stopped = await waitForHealthState(config.daemonPort, false, stopTimeoutMs, pollIntervalMs);
    if (!stopped) {
      throw new Error('daemon_failed_to_stop');
    }
  }

  await ensureDaemonRunning(config, extensionDir);

  if (wasHealthy && previousStartedAt) {
    const restarted = await waitForNewStartTime(config, previousStartedAt, stopTimeoutMs, pollIntervalMs);
    if (!restarted) {
      throw new Error('daemon_restart_not_observed');
    }
  }
}

export async function isDaemonHealthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function startDaemonProcess(config: Config, extensionDir: string): Promise<void> {
  const daemonEntry = path.join(extensionDir, 'dist', 'daemon.cjs');
  const logPath = path.join(extensionDir, 'daemon.log');

  const outFd = fs.openSync(logPath, 'a');
  const errFd = fs.openSync(logPath, 'a');

  const child = spawn(process.execPath, [daemonEntry], {
    cwd: extensionDir,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env },
  });

  child.unref();

  const started = await waitForHealth(config.daemonPort, 150000);
  if (!started) {
    throw new Error('daemon_failed_to_start');
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  return waitForHealthState(port, true, timeoutMs, HEALTH_POLL_MS);
}

async function waitForHealthState(
  port: number,
  shouldBeHealthy: boolean,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await isDaemonHealthy(port)) === shouldBeHealthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

async function getDaemonStartedAt(config: Config): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: config.daemonPort,
        path: '/status',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }

          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { startedAt?: unknown };
            resolve(typeof parsed.startedAt === 'string' ? parsed.startedAt : null);
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function waitForNewStartTime(
  config: Config,
  previousStartedAt: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentStartedAt = await getDaemonStartedAt(config);
    if (currentStartedAt && currentStartedAt !== previousStartedAt) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}
