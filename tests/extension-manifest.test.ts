import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEnvFile } from '../src/shared/config.js';
import { CONFIG_ENV_KEYS, ENV, INSTALL_SETTING_ENV_KEYS } from '../src/shared/config-vars.js';

const repoRoot = process.cwd();

describe('extension metadata', () => {
  it('keeps install prompts aligned with centralized setup variables', () => {
    const manifest = readJson('gemini-extension.json') as {
      description?: string;
      settings?: Array<{ envVar?: string }>;
      mcpServers?: Record<string, { env?: Record<string, string> }>;
      contextFileName?: string;
    };
    const pkg = readJson('package.json') as { description?: string };

    const settingEnvVars = manifest.settings?.map((setting) => setting.envVar) ?? [];
    expect(settingEnvVars).toEqual([...INSTALL_SETTING_ENV_KEYS]);
    expect(Object.keys(manifest.mcpServers?.['discord-bridge']?.env ?? {})).toEqual([...INSTALL_SETTING_ENV_KEYS]);
    expect(manifest.description).toBe(pkg.description);
  });

  it('does not ship extension-level GEMINI.md persona context', () => {
    const manifest = readJson('gemini-extension.json') as { contextFileName?: string };

    expect(manifest.contextFileName).toBeUndefined();
    for (const fileName of ['GEMINI.md', 'Gemini.md', 'gemini.md']) {
      expect(fs.existsSync(path.join(repoRoot, fileName))).toBe(false);
    }
  });

  it('keeps .env.example variables inside the centralized config allowlist', () => {
    const envExample = parseEnvFile(path.join(repoRoot, '.env.example'));
    const allowed = new Set<string>(CONFIG_ENV_KEYS);

    for (const key of Object.keys(envExample)) {
      expect(allowed.has(key), `${key} should be centralized in config-vars.ts`).toBe(true);
    }
    for (const key of INSTALL_SETTING_ENV_KEYS) {
      expect(envExample[key]).toBeTruthy();
    }
    expect(envExample[ENV.DISCORD_BOT_TOKEN]).toBe('your_bot_token_here');
  });
});

function readJson(fileName: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, fileName), 'utf-8'));
}
