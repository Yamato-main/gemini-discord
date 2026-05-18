import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, resolveExtensionDir } from '../src/shared/config.js';
import { ensureRuntimePaths } from '../src/shared/runtime-paths.js';
import { updateManagedConfigFile } from '../src/shared/managed-config.js';
import { restartDaemon } from '../src/shared/daemon-runtime.js';
import { ENV, SETUP_ENV_KEYS_TO_CLEAR, SETUP_RUNTIME_DEFAULTS } from '../src/shared/config-vars.js';

interface SetupInput {
  botToken: string;
  userId: string;
  serverId: string;
}

async function main(): Promise<void> {
  let tmpDir = process.cwd();
  try { tmpDir = __dirname; } catch {}
  const extensionDir = resolveExtensionDir(tmpDir);
  const rl = createInterface({ input, output });

  try {
    output.write('gemini-discord setup\n');
    output.write(`Extension directory: ${extensionDir}\n\n`);

    const setupInput = validateSetupInput(await promptForSetupInput(rl));
    writeSetupConfig(extensionDir, setupInput);

    installDependencies(extensionDir);
    buildExtension(extensionDir);

    await restartDaemon(loadConfig(extensionDir), extensionDir);
    output.write('\nSetup complete. A Discord DM confirmation will be sent when the bot finishes startup.\n');
  } finally {
    rl.close();
  }
}

export async function promptForSetupInput(rl: Pick<Interface, 'question'>): Promise<SetupInput> {
  const botToken = (await rl.question('Bot Token: ')).trim();
  const userId = (await rl.question('Boss User ID: ')).trim();
  const serverId = (await rl.question('Server ID: ')).trim();
  return { botToken, userId, serverId };
}

export function validateSetupInput(input: SetupInput): SetupInput {
  const botToken = input.botToken.trim();
  const userId = input.userId.trim();
  const serverId = input.serverId.trim();

  if (!botToken) {
    throw new Error('Bot Token is required.');
  }
  if (!isDiscordSnowflake(userId)) {
    throw new Error('Boss User ID must be a Discord numeric snowflake.');
  }
  if (!isDiscordSnowflake(serverId)) {
    throw new Error('Server ID must be a Discord numeric snowflake.');
  }

  return { botToken, userId, serverId };
}

export function buildSetupEnv(input: SetupInput): Record<string, string> {
  return {
    [ENV.DISCORD_BOT_TOKEN]: input.botToken,
    [ENV.DISCORD_SERVER_ID]: input.serverId,
    [ENV.DISCORD_BOSS_USER_ID]: input.userId,
    [ENV.DISCORD_OWNER_IDS]: input.userId,
    [ENV.DISCORD_ADMIN_ID]: input.userId,
    [ENV.DISCORD_ALLOWED_USER_IDS]: input.userId,
    ...SETUP_RUNTIME_DEFAULTS,
  };
}

export function writeSetupConfig(extensionDir: string, input: SetupInput): void {
  const paths = ensureRuntimePaths(extensionDir);
  const setupEnv = buildSetupEnv(input);

  updateManagedConfigFile(paths.managedConfigFile, (current) => {
    const env = { ...current.env };
    for (const key of SETUP_ENV_KEYS_TO_CLEAR) {
      delete env[key];
    }

    return {
      ...current,
      env: {
        ...env,
        ...setupEnv,
      },
      discord: {
        ...current.discord,
        primaryGuildId: input.serverId,
      },
    };
  });
}

function installDependencies(extensionDir: string): void {
  if (!fs.existsSync(path.join(extensionDir, 'package.json'))) {
    return;
  }

  const args = fs.existsSync(path.join(extensionDir, 'package-lock.json')) ? ['ci'] : ['install'];
  execFileSync(npmCommand(), args, {
    cwd: extensionDir,
    stdio: 'inherit',
  });
}

function buildExtension(extensionDir: string): void {
  if (!fs.existsSync(path.join(extensionDir, 'package.json'))) {
    return;
  }

  execFileSync(npmCommand(), ['run', 'build'], {
    cwd: extensionDir,
    stdio: 'inherit',
  });
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{15,25}$/.test(value);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry || process.env['VITEST']) {
    return false;
  }

  const entryName = path.basename(entry);
  return entryName === 'setup.cjs' || entryName === 'setup.ts';
}

if (isMainModule()) {
  main().catch((err) => {
    process.stderr.write(`gemini-discord setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
