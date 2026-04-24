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

// scripts/setup.ts
var crypto = __toESM(require("node:crypto"), 1);
var fs2 = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path2 = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");
var import_promises = require("node:readline/promises");
var import_node_process = require("node:process");

// src/shared/config.ts
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);
function parseEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    const commentIndex = value.indexOf("#");
    if (commentIndex > 0 && value[commentIndex - 1] === " ") {
      value = value.slice(0, commentIndex).trim();
    }
    result[key] = value;
  }
  return result;
}
function splitIds(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
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

// scripts/setup.ts
var tmpDir = process.cwd();
try {
  tmpDir = __dirname;
} catch {
}
var extensionDir = resolveExtensionDir(tmpDir);
var envPath = path2.join(extensionDir, ".env");
var launchAgentLabel = "com.gemini-discord.daemon";
async function main() {
  const existing = parseEnvFile(envPath);
  const rl = (0, import_promises.createInterface)({ input: import_node_process.stdin, output: import_node_process.stdout });
  try {
    import_node_process.stdout.write("gemini-discord setup wizard\n");
    import_node_process.stdout.write(`Working directory: ${extensionDir}

`);
    const config = {
      discordBotToken: await ask(rl, "Discord Bot Token", existing["DISCORD_BOT_TOKEN"], true),
      discordChannelId: await ask(rl, "Primary Discord Channel ID", existing["DISCORD_CHANNEL_ID"]),
      ownerIds: splitCsv(await ask(rl, "Owner Discord User IDs (comma-separated)", existing["DISCORD_OWNER_IDS"])),
      discordBossId: "",
      allowedChannelIds: splitCsv(await ask(rl, "Allowed Channel IDs (comma-separated)", existing["ALLOWED_CHANNEL_IDS"])),
      allowedUserIds: splitCsv(await ask(
        rl,
        "Additional allowed human speaker IDs (blank = owners only)",
        existing["DISCORD_ALLOWED_USER_IDS"]
      )),
      allowedAgentIds: splitCsv(await ask(
        rl,
        "Allowed peer agent/bot IDs (comma-separated, optional)",
        existing["DISCORD_ALLOWED_AGENT_IDS"]
      )),
      discordPrefix: await ask(rl, "Optional command prefix", existing["DISCORD_PREFIX"]),
      requireMention: await askBoolean(rl, "Require mention/reply in guild channels?", existing["REQUIRE_MENTION"], false),
      respondToReplies: await askBoolean(rl, "Respond when users reply to the bot?", existing["RESPOND_TO_REPLIES"], true),
      enableDMs: await askBoolean(rl, "Enable Discord DMs?", existing["ENABLE_DMS"], true),
      memoryScope: await askEnum(rl, "Memory scope", existing["MEMORY_SCOPE"] || "channel", ["global", "channel"]),
      useGeminiCliSessions: await askBoolean(
        rl,
        "Reuse real Gemini CLI sessions for Discord bindings?",
        existing["USE_GEMINI_CLI_SESSIONS"],
        false
      ),
      geminiSessionBindingScope: await askEnum(
        rl,
        "Gemini session binding scope",
        existing["GEMINI_SESSION_BINDING_SCOPE"] || "channel",
        ["server", "channel", "global"]
      ),
      geminiPath: await ask(rl, "Gemini CLI path", existing["GEMINI_PATH"] || "gemini"),
      geminiModel: await ask(rl, "Gemini model", existing["GEMINI_MODEL"] || "gemini-3.1-pro-preview"),
      daemonPort: await ask(rl, "Daemon port", existing["DAEMON_PORT"] || "18790"),
      streaming: await askBoolean(rl, "Use streaming replies?", existing["STREAMING"], true),
      autoStartDaemon: await askBoolean(rl, "Auto-start daemon when the extension runs?", existing["AUTO_START_DAEMON"], true),
      conversationHistoryLength: await ask(rl, "Conversation history length (pairs)", existing["CONVERSATION_HISTORY_LENGTH"] || "30"),
      queueMaxDepth: await ask(rl, "Queue max depth", existing["QUEUE_MAX_DEPTH"] || "20"),
      geminiTimeoutMs: await ask(rl, "Gemini timeout (ms)", existing["GEMINI_TIMEOUT_MS"] || "300000"),
      daemonApiToken: existing["DAEMON_API_TOKEN"] || crypto.randomBytes(32).toString("hex"),
      discordResetCmd: existing["DISCORD_RESET_CMD"] || "!reset"
    };
    config.discordBossId = await ask(
      rl,
      "Admin Discord User ID (privileged actions only)",
      existing["DISCORD_BOSS_ID"] || config.ownerIds[0]
    );
    if (!config.allowedChannelIds.includes(config.discordChannelId)) {
      config.allowedChannelIds.unshift(config.discordChannelId);
    }
    const finalAllowedUsers = config.allowedUserIds.length > 0 ? config.allowedUserIds : config.ownerIds;
    validateRequired(config.discordBotToken, "Discord Bot Token");
    validateRequired(config.discordChannelId, "Primary Discord Channel ID");
    validateRequired(config.discordBossId, "Admin Discord User ID");
    validateList(config.ownerIds, "Owner Discord User IDs");
    validateList(config.allowedChannelIds, "Allowed Channel IDs");
    const envContent = [
      "# gemini-discord generated configuration",
      `DISCORD_BOT_TOKEN=${config.discordBotToken}`,
      `DISCORD_CHANNEL_ID=${config.discordChannelId}`,
      `DISCORD_OWNER_IDS=${config.ownerIds.join(",")}`,
      `DISCORD_BOSS_ID=${config.discordBossId}`,
      `ALLOWED_CHANNEL_IDS=${config.allowedChannelIds.join(",")}`,
      `DISCORD_ALLOWED_USER_IDS=${finalAllowedUsers.join(",")}`,
      `DISCORD_ALLOWED_AGENT_IDS=${config.allowedAgentIds.join(",")}`,
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
      ""
    ].join("\n");
    fs2.writeFileSync(envPath, envContent, { mode: 384 });
    fs2.chmodSync(envPath, 384);
    import_node_process.stdout.write(`
Wrote ${envPath}
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
    import_node_process.stdout.write("\nSetup complete.\n");
    import_node_process.stdout.write("Next steps:\n");
    import_node_process.stdout.write("- Link the extension with `gemini extensions link .`\n");
    import_node_process.stdout.write("- If you skipped launchd, start the daemon manually with `npm run start:daemon`\n");
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
async function ask(rl, label, current, preserveOnBlank = false) {
  const suffix = current ? preserveOnBlank ? " [press enter to keep current value]" : ` [${current}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  if (!answer) {
    return preserveOnBlank ? current ?? "" : current ?? "";
  }
  return answer;
}
async function askBoolean(rl, label, current, fallback) {
  const currentValue = current === void 0 || current === "" ? fallback : current.toLowerCase() === "true";
  const prompt = `${label} [${currentValue ? "Y/n" : "y/N"}]: `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (!answer) return currentValue;
  return answer === "y" || answer === "yes" || answer === "true";
}
async function askEnum(rl, label, current, allowed) {
  const answer = (await rl.question(`${label} (${allowed.join("/")}) [${current}]: `)).trim();
  const value = answer || current;
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function splitCsv(value) {
  return splitIds(value || "");
}
function validateRequired(value, label) {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}
function validateList(values, label) {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
}
function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
main().catch((err) => {
  process.stderr.write(`gemini-discord setup failed: ${err instanceof Error ? err.message : String(err)}
`);
  process.exit(1);
});
