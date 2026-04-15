import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveExtensionDir } from '../shared/config.js';

let extensionDir = '';
let logPath = '';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

try {
  extensionDir = resolveExtensionDir(process.cwd()); // resolve from cwd or we could just use __dirname.
  logPath = path.join(extensionDir, 'daemon.log');
} catch {
  logPath = path.join(process.cwd(), 'daemon.log');
}

function rotateIfNeeded() {
  try {
    const stats = fs.statSync(logPath, { throwIfNoEntry: false });
    if (stats && stats.size > MAX_LOG_SIZE) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {
    // ignore
  }
}

function emit(level: string, msg: string, data?: object): void {
  const entry = { t: new Date().toISOString(), l: level, m: msg, ...data };
  const line = JSON.stringify(entry) + '\n';
  process.stdout.write(line);
  
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath, line);
  } catch {
    // suppress local file errors to prevent daemon crash
  }
}

export const log = {
  info:  (msg: string, data?: object) => emit('INFO',  msg, data),
  warn:  (msg: string, data?: object) => emit('WARN',  msg, data),
  error: (msg: string, data?: object) => emit('ERROR', msg, data),
};
