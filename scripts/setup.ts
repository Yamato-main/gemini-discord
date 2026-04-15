import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseEnvFile, resolveExtensionDir, splitIds } from '../src/shared/config.js';

const extensionDir = resolveExtensionDir(__dirname);
const envPath = path.join(extensionDir, '.env');
const launchAgentLabel = 'com.gemini-discord.daemon';

async function main(): Promise<void> {
  const existing = parseEnvFile(envPath);
  const rl = createInterface({ input, output });

  try {
    output.write('gemini-discord setup wizard\n');
    output.write(`Working directory: ${extensionDir}\n\n`);

    const config = {
      discordBotToken: await ask(rl, 'Discord Bot Token', existing['DISCORD_BOT_TOKEN'], true),
      discordChannelId: await ask(rl, 'Primary Discord Channel ID', existing['DISCORD_CHANNEL_ID']),
      ownerIds: splitCsv(await ask(rl, 'Owner Discord User IDs (comma-separated)', existing['DISCORD_OWNER_IDS'])),
      allowedChannelIds: splitCsv(await ask(rl, 'Allowed Channel IDs (comma-separated)', existing['ALLOWED_CHANNEL_IDS'])),
      allowedUserIds: splitCsv(await ask(
        rl,
        'Additional allowed human speaker IDs (blank = owners only)',
        existing['DISCORD_ALLOWED_USER_IDS'],
      )),
      allowedAgentIds: splitCsv(await ask(
        rl,
        'Allowed peer agent/bot IDs (comma-separated, optional)',
        existing['DISCORD_ALLOWED_AGENT_IDS'],
      )),
      discordPrefix: await ask(rl, 'Optional command prefix', existing['DISCORD_PREFIX']),
      requireMention: await askBoolean(rl, 'Require mention/reply in guild channels?', existing['REQUIRE_MENTION'], false),
      respondToReplies: await askBoolean(rl, 'Respond when users reply to the bot?', existing['RESPOND_TO_REPLIES'], true),
      enableDMs: await askBoolean(rl, 'Enable Discord DMs?', existing['ENABLE_DMS'], true),
      memoryScope: await askEnum(rl, 'Memory scope', existing['MEMORY_SCOPE'] || 'global', ['global', 'channel']),
      useGeminiCliSessions: await askBoolean(
        rl,
        'Reuse real Gemini CLI sessions for Discord bindings?',
        existing['USE_GEMINI_CLI_SESSIONS'],
        true,
      ),
      geminiSessionBindingScope: await askEnum(
        rl,
        'Gemini session binding scope',
        existing['GEMINI_SESSION_BINDING_SCOPE'] || 'server',
        ['server', 'channel', 'global'],
      ),
      geminiPath: await ask(rl, 'Gemini CLI path', existing['GEMINI_PATH'] || 'gemini'),
      geminiModel: await ask(rl, 'Gemini model', existing['GEMINI_MODEL'] || 'gemini-3.1-pro-preview'),
      daemonPort: await ask(rl, 'Daemon port', existing['DAEMON_PORT'] || '18790'),
      streaming: await askBoolean(rl, 'Use streaming replies?', existing['STREAMING'], true),
      autoStartDaemon: await askBoolean(rl, 'Auto-start daemon when the extension runs?', existing['AUTO_START_DAEMON'], true),
      conversationHistoryLength: await ask(rl, 'Conversation history length (pairs)', existing['CONVERSATION_HISTORY_LENGTH'] || '10'),
      queueMaxDepth: await ask(rl, 'Queue max depth', existing['QUEUE_MAX_DEPTH'] || '20'),
      geminiTimeoutMs: await ask(rl, 'Gemini timeout (ms)', existing['GEMINI_TIMEOUT_MS'] || '300000'),
      daemonApiToken: existing['DAEMON_API_TOKEN'] || crypto.randomBytes(32).toString('hex'),
      discordResetCmd: existing['DISCORD_RESET_CMD'] || '!reset',
    };

    if (!config.allowedChannelIds.includes(config.discordChannelId)) {
      config.allowedChannelIds.unshift(config.discordChannelId);
    }

    const finalAllowedUsers = config.allowedUserIds.length > 0 ? config.allowedUserIds : config.ownerIds;

    validateRequired(config.discordBotToken, 'Discord Bot Token');
    validateRequired(config.discordChannelId, 'Primary Discord Channel ID');
    validateList(config.ownerIds, 'Owner Discord User IDs');
    validateList(config.allowedChannelIds, 'Allowed Channel IDs');

    const envContent = [
      '# gemini-discord generated configuration',
      `DISCORD_BOT_TOKEN=${config.discordBotToken}`,
      `DISCORD_CHANNEL_ID=${config.discordChannelId}`,
      `DISCORD_OWNER_IDS=${config.ownerIds.join(',')}`,
      `ALLOWED_CHANNEL_IDS=${config.allowedChannelIds.join(',')}`,
      `DISCORD_ALLOWED_USER_IDS=${finalAllowedUsers.join(',')}`,
      `DISCORD_ALLOWED_AGENT_IDS=${config.allowedAgentIds.join(',')}`,
      `DAEMON_API_TOKEN=${config.daemonApiToken}`,
      `DISCORD_PREFIX=${config.discordPrefix}`,
      `DISCORD_RESET_CMD=${config.discordResetCmd}`,
      `DAEMON_PORT=${config.daemonPort}`,
      `GEMINI_PATH=${config.geminiPath}`,
      `GEMINI_MODEL=${config.geminiModel}`,
      `GEMINI_TIMEOUT_MS=${config.geminiTimeoutMs}`,
      `CONVERSATION_HISTORY_LENGTH=${config.conversationHistoryLength}`,
      `STREAMING=${String(config.streaming)}`,
      `QUEUE_MAX_DEPTH=${config.queueMaxDepth}`,
      `ENABLE_DMS=${String(config.enableDMs)}`,
      `REQUIRE_MENTION=${String(config.requireMention)}`,
      `RESPOND_TO_REPLIES=${String(config.respondToReplies)}`,
      `MEMORY_SCOPE=${config.memoryScope}`,
      `AUTO_START_DAEMON=${String(config.autoStartDaemon)}`,
      `USE_GEMINI_CLI_SESSIONS=${String(config.useGeminiCliSessions)}`,
      `GEMINI_SESSION_BINDING_SCOPE=${config.geminiSessionBindingScope}`,
      '',
    ].join('\n');

    fs.writeFileSync(envPath, envContent, { mode: 0o600 });
    fs.chmodSync(envPath, 0o600);
    output.write(`\nWrote ${envPath}\n`);

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
    } else if (process.platform === 'linux') {
      const installService = await askBoolean(
        rl,
        'Install or refresh the Linux systemd service now?',
        '',
        false,
      );

      if (installService) {
        ensureBuiltArtifacts();
        const servicePath = installSystemdService();
        output.write(`Installed systemd service at ${servicePath}\n`);
        output.write(`Run: systemctl --user enable --now gemini-discord\n`);
      }
    } else {
      output.write('Service install skipped: unsupported OS.\n');
    }

    output.write('\nSetup complete.\n');
    output.write('Next steps:\n');
    output.write('- Link the extension with `gemini extensions link .`\n');
    output.write('- If you skipped service installation, start the daemon manually with `npm run start:daemon`\n');
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

function installSystemdService(): string {
  const daemonEntry = path.join(extensionDir, 'dist', 'daemon.cjs');
  const serviceName = 'gemini-discord.service';
  const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(systemdDir, serviceName);

  fs.mkdirSync(systemdDir, { recursive: true });
  fs.writeFileSync(servicePath, buildSystemdService(daemonEntry), 'utf-8');

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  } catch {
    // Ignore: systemctl might not be available or command failed
  }
  
  return servicePath;
}

function buildSystemdService(daemonEntry: string): string {
  const nodePath = process.execPath;
  const safePath = process.env.PATH ?? '';

  return `[Unit]
Description=Gemini Discord Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonEntry}
WorkingDirectory=${extensionDir}
Environment="PATH=${safePath}"
Restart=always

[Install]
WantedBy=default.target
`;
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current?: string,
  preserveOnBlank = false,
): Promise<string> {
  const suffix = current
    ? preserveOnBlank
      ? ' [press enter to keep current value]'
      : ` [${current}]`
    : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  if (!answer) {
    return preserveOnBlank ? (current ?? '') : (current ?? '');
  }
  return answer;
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

async function askEnum(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current: string,
  allowed: string[],
): Promise<string> {
  const answer = (await rl.question(`${label} (${allowed.join('/')}) [${current}]: `)).trim();
  const value = answer || current;
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function splitCsv(value: string): string[] {
  return splitIds(value || '');
}

function validateRequired(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

function validateList(values: string[], label: string): void {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
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
  process.stderr.write(`gemini-discord setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
