/**
 * Structured JSONL logger for the daemon.
 * Writes to stdout — launchd/systemd capture and handle rotation.
 */

function emit(level: string, msg: string, data?: object): void {
  const entry = { t: new Date().toISOString(), l: level, m: msg, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export const log = {
  info: (msg: string, data?: object) => emit('ℹ️ INFO', msg, data),
  warn: (msg: string, data?: object) => emit('⚠️ WARN', msg, data),
  error: (msg: string, data?: object) => emit('❌ ERROR', msg, data),
};
