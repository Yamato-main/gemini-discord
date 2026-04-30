import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RuntimePaths {
  runtimeDir: string;
  bindingsDir: string;
  managedConfigFile: string;
  daemonTokenFile: string;
  daemonLogFile: string;
  memoryFile: string;
  memoryTmpFile: string;
  cronFile: string;
  dmPairingsFile: string;
}

export function resolveRuntimePaths(extensionDir: string): RuntimePaths {
  const runtimeDir = path.join(extensionDir, '.gemini-discord');

  return {
    runtimeDir,
    bindingsDir: path.join(runtimeDir, 'bindings'),
    managedConfigFile: resolveManagedRuntimePath(extensionDir, 'config.json'),
    daemonTokenFile: resolveManagedRuntimePath(extensionDir, 'daemon-token', '.daemon-token'),
    daemonLogFile: resolveManagedRuntimePath(extensionDir, 'daemon.log', 'daemon.log'),
    memoryFile: resolveManagedRuntimePath(extensionDir, 'memory.json', '.memory.json'),
    memoryTmpFile: resolveManagedRuntimePath(extensionDir, 'memory.json.tmp', '.memory.json.tmp'),
    cronFile: resolveManagedRuntimePath(extensionDir, 'cron.json', '.cron.json'),
    dmPairingsFile: path.join(runtimeDir, 'dm-pairings.json'),
  };
}

export function ensureRuntimePaths(extensionDir: string): RuntimePaths {
  const paths = resolveRuntimePaths(extensionDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.mkdirSync(paths.bindingsDir, { recursive: true });
  return paths;
}

function resolveManagedRuntimePath(
  extensionDir: string,
  runtimeRelativePath: string,
  legacyFileName?: string,
): string {
  const runtimeDir = path.join(extensionDir, '.gemini-discord');
  const runtimePath = path.join(runtimeDir, runtimeRelativePath);
  const legacyPath = legacyFileName ? path.join(extensionDir, legacyFileName) : null;

  if (fs.existsSync(runtimePath) || !legacyPath || !fs.existsSync(legacyPath)) {
    return runtimePath;
  }

  try {
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.renameSync(legacyPath, runtimePath);
    return runtimePath;
  } catch {
    return legacyPath;
  }
}
