import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveExtensionDir } from '../src/shared/config.js';

let tmpDir = process.cwd();
try { tmpDir = __dirname; } catch {}
const extensionDir = resolveExtensionDir(tmpDir);
const launchAgentLabel = 'com.gemini-discord.daemon';

async function main(): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    output.write('gemini-discord macOS Service Installer\n');
    output.write(`Working directory: ${extensionDir}\n\n`);

    if (process.platform === 'darwin') {
      const installService = await askBoolean(
        rl,
        'Install or refresh the macOS launchd service now?',
        '',
        false,
      );

      if (installService) {
        ensureBuiltArtifacts();
        const plistPath = installLaunchAgent();
        output.write(`Installed launchd service at ${plistPath}\n`);
      }
    } else {
      output.write('launchd install skipped: not running on macOS.\n');
    }

    output.write('\nInstallation complete.\n');
  } finally {
    rl.close();
  }
}

function ensureBuiltArtifacts(): void {
  const daemonEntry = path.join(extensionDir, 'dist', 'daemon.cjs');
  if (!fs.existsSync(daemonEntry)) {
    throw new Error('dist/daemon.cjs is missing. Run `npm run build` before installing the service.');
  }
}

function installLaunchAgent(): string {
  const daemonEntry = path.join(extensionDir, 'dist', 'daemon.cjs');
  const logPath = path.join(extensionDir, 'daemon.log');
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel}.plist`);

  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, buildLaunchAgentPlist(daemonEntry, logPath), 'utf-8');

  const domain = `gui/${process.getuid?.() ?? ''}`;
  try {
    execFileSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
  } catch {
    // Ignore: service may not be loaded yet.
  }

  execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' });
  execFileSync('launchctl', ['kickstart', '-k', `${domain}/${launchAgentLabel}`], { stdio: 'inherit' });
  return plistPath;
}

function buildLaunchAgentPlist(daemonEntry: string, logPath: string): string {
  const nodePath = process.execPath;
  const safePath = escapeXml(process.env.PATH ?? '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${launchAgentLabel}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(nodePath)}</string>
      <string>${escapeXml(daemonEntry)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(extensionDir)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${safePath}</string>
    </dict>
  </dict>
</plist>
`;
}

async function askBoolean(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current: string | undefined,
  fallback: boolean,
): Promise<boolean> {
  const currentValue = current === undefined || current === '' ? fallback : current.toLowerCase() === 'true';
  const prompt = `${label} [${currentValue ? 'Y/n' : 'y/N'}]: `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (!answer) return currentValue;
  return answer === 'y' || answer === 'yes' || answer === 'true';
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

main().catch((err) => {
  process.stderr.write(`gemini-discord install-service failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
