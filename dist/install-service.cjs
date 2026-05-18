"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/install-service.ts
var fs2 = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path2 = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");
var import_promises = require("node:readline/promises");
var import_node_process = require("node:process");

// src/shared/config.ts
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);

// src/shared/config-vars.ts
var ENV = {
  DISCORD_BOT_TOKEN: "DISCORD_BOT_TOKEN",
  DISCORD_SERVER_ID: "DISCORD_SERVER_ID",
  DISCORD_CHANNEL_ID: "DISCORD_CHANNEL_ID",
  DISCORD_BOSS_USER_ID: "DISCORD_BOSS_USER_ID",
  DISCORD_OWNER_IDS: "DISCORD_OWNER_IDS",
  DISCORD_ADMIN_ID: "DISCORD_ADMIN_ID",
  DISCORD_ALLOWED_CHANNEL_IDS: "DISCORD_ALLOWED_CHANNEL_IDS",
  DISCORD_ALLOWED_USER_IDS: "DISCORD_ALLOWED_USER_IDS",
  DISCORD_ALLOWED_AGENT_IDS: "DISCORD_ALLOWED_AGENT_IDS",
  DAEMON_API_TOKEN: "DAEMON_API_TOKEN",
  DISCORD_PREFIX: "DISCORD_PREFIX",
  DISCORD_RESET_CMD: "DISCORD_RESET_CMD",
  DAEMON_PORT: "DAEMON_PORT",
  GEMINI_PATH: "GEMINI_PATH",
  GEMINI_MODEL: "GEMINI_MODEL",
  GEMINI_TIMEOUT_MS: "GEMINI_TIMEOUT_MS",
  GEMINI_MAX_CONCURRENT: "GEMINI_MAX_CONCURRENT",
  CONVERSATION_HISTORY_LENGTH: "CONVERSATION_HISTORY_LENGTH",
  PROMPT_HISTORY_MAX_MESSAGES: "PROMPT_HISTORY_MAX_MESSAGES",
  PROMPT_HISTORY_MAX_CHARS: "PROMPT_HISTORY_MAX_CHARS",
  STREAMING: "STREAMING",
  QUEUE_MAX_DEPTH: "QUEUE_MAX_DEPTH",
  ENABLE_DMS: "ENABLE_DMS",
  REQUIRE_MENTION: "REQUIRE_MENTION",
  RESPOND_TO_REPLIES: "RESPOND_TO_REPLIES",
  MEMORY_SCOPE: "MEMORY_SCOPE",
  AUTO_START_DAEMON: "AUTO_START_DAEMON",
  USE_GEMINI_CLI_SESSIONS: "USE_GEMINI_CLI_SESSIONS",
  GEMINI_SESSION_BINDING_SCOPE: "GEMINI_SESSION_BINDING_SCOPE",
  CLI_IDLE_TIMEOUT_MS: "CLI_IDLE_TIMEOUT_MS",
  SETUP_VALIDATION_PENDING: "SETUP_VALIDATION_PENDING"
};
var CONFIG_ENV_KEYS = [
  ENV.DISCORD_BOT_TOKEN,
  ENV.DISCORD_SERVER_ID,
  ENV.DISCORD_CHANNEL_ID,
  ENV.DISCORD_BOSS_USER_ID,
  ENV.DISCORD_OWNER_IDS,
  ENV.DISCORD_ADMIN_ID,
  ENV.DISCORD_ALLOWED_CHANNEL_IDS,
  ENV.DISCORD_ALLOWED_USER_IDS,
  ENV.DISCORD_ALLOWED_AGENT_IDS,
  ENV.DAEMON_API_TOKEN,
  ENV.DISCORD_PREFIX,
  ENV.DISCORD_RESET_CMD,
  ENV.DAEMON_PORT,
  ENV.GEMINI_PATH,
  ENV.GEMINI_MODEL,
  ENV.GEMINI_TIMEOUT_MS,
  ENV.GEMINI_MAX_CONCURRENT,
  ENV.CONVERSATION_HISTORY_LENGTH,
  ENV.PROMPT_HISTORY_MAX_MESSAGES,
  ENV.PROMPT_HISTORY_MAX_CHARS,
  ENV.STREAMING,
  ENV.QUEUE_MAX_DEPTH,
  ENV.ENABLE_DMS,
  ENV.REQUIRE_MENTION,
  ENV.RESPOND_TO_REPLIES,
  ENV.MEMORY_SCOPE,
  ENV.AUTO_START_DAEMON,
  ENV.USE_GEMINI_CLI_SESSIONS,
  ENV.GEMINI_SESSION_BINDING_SCOPE,
  ENV.CLI_IDLE_TIMEOUT_MS,
  ENV.SETUP_VALIDATION_PENDING
];
var INSTALL_SETTING_ENV_KEYS = [
  ENV.DISCORD_BOT_TOKEN,
  ENV.DISCORD_BOSS_USER_ID,
  ENV.DISCORD_OWNER_IDS,
  ENV.DISCORD_SERVER_ID
];
var REQUIRED_DAEMON_ENV_KEYS = [
  ENV.DISCORD_BOT_TOKEN,
  ENV.DISCORD_OWNER_IDS,
  ENV.DISCORD_SERVER_ID
];
var SETUP_ENV_KEYS_TO_CLEAR = [
  ENV.DISCORD_CHANNEL_ID,
  ENV.DISCORD_ALLOWED_CHANNEL_IDS
];
var SETUP_RUNTIME_DEFAULTS = {
  [ENV.ENABLE_DMS]: "true",
  [ENV.REQUIRE_MENTION]: "false",
  [ENV.AUTO_START_DAEMON]: "true",
  [ENV.MEMORY_SCOPE]: "channel",
  [ENV.GEMINI_SESSION_BINDING_SCOPE]: "channel",
  [ENV.SETUP_VALIDATION_PENDING]: "true"
};

// src/shared/config.ts
var LEGACY_ENV_ALIASES = {
  [ENV.DISCORD_ALLOWED_CHANNEL_IDS]: ["ALLOWED_CHANNEL_IDS"]
};
function resolveExtensionDir(fromDir) {
  let dir = fromDir;
  if (dir.startsWith("file://")) {
    dir = path.dirname(new URL(dir).pathname);
  }
  if (path.basename(dir) === "dist") {
    return path.dirname(dir);
  }
  let current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "gemini-extension.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return dir;
}

// scripts/install-service.ts
var tmpDir = process.cwd();
try {
  tmpDir = __dirname;
} catch {
}
var extensionDir = resolveExtensionDir(tmpDir);
var launchAgentLabel = "com.gemini-discord.daemon";
async function main() {
  const rl = (0, import_promises.createInterface)({ input: import_node_process.stdin, output: import_node_process.stdout });
  try {
    import_node_process.stdout.write("gemini-discord macOS Service Installer\n");
    import_node_process.stdout.write(`Working directory: ${extensionDir}

`);
    if (process.platform === "darwin") {
      const installService = await askBoolean(
        rl,
        "Install or refresh the macOS launchd service now?",
        "",
        false
      );
      if (installService) {
        ensureBuiltArtifacts();
        const plistPath = installLaunchAgent();
        import_node_process.stdout.write(`Installed launchd service at ${plistPath}
`);
      }
    } else {
      import_node_process.stdout.write("launchd install skipped: not running on macOS.\n");
    }
    import_node_process.stdout.write("\nInstallation complete.\n");
  } finally {
    rl.close();
  }
}
function ensureBuiltArtifacts() {
  const daemonEntry = path2.join(extensionDir, "dist", "daemon.cjs");
  if (!fs2.existsSync(daemonEntry)) {
    throw new Error("dist/daemon.cjs is missing. Run `npm run build` before installing the service.");
  }
}
function installLaunchAgent() {
  const daemonEntry = path2.join(extensionDir, "dist", "daemon.cjs");
  const logPath = path2.join(extensionDir, "daemon.log");
  const plistPath = path2.join(os.homedir(), "Library", "LaunchAgents", `${launchAgentLabel}.plist`);
  fs2.mkdirSync(path2.dirname(plistPath), { recursive: true });
  fs2.writeFileSync(plistPath, buildLaunchAgentPlist(daemonEntry, logPath), "utf-8");
  const domain = `gui/${process.getuid?.() ?? ""}`;
  try {
    (0, import_node_child_process.execFileSync)("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  } catch {
  }
  (0, import_node_child_process.execFileSync)("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
  (0, import_node_child_process.execFileSync)("launchctl", ["kickstart", "-k", `${domain}/${launchAgentLabel}`], { stdio: "inherit" });
  return plistPath;
}
function buildLaunchAgentPlist(daemonEntry, logPath) {
  const nodePath = process.execPath;
  const safePath = escapeXml(process.env.PATH ?? "");
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
async function askBoolean(rl, label, current, fallback) {
  const currentValue = current === void 0 || current === "" ? fallback : current.toLowerCase() === "true";
  const prompt = `${label} [${currentValue ? "Y/n" : "y/N"}]: `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (!answer) return currentValue;
  return answer === "y" || answer === "yes" || answer === "true";
}
function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
main().catch((err) => {
  process.stderr.write(`gemini-discord install-service failed: ${err instanceof Error ? err.message : String(err)}
`);
  process.exit(1);
});
