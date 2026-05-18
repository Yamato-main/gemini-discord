"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/setup.ts
var setup_exports = {};
__export(setup_exports, {
  buildSetupEnv: () => buildSetupEnv,
  promptForSetupInput: () => promptForSetupInput,
  validateSetupInput: () => validateSetupInput,
  writeSetupConfig: () => writeSetupConfig
});
module.exports = __toCommonJS(setup_exports);
var fs5 = __toESM(require("node:fs"), 1);
var path5 = __toESM(require("node:path"), 1);
var import_node_child_process2 = require("node:child_process");
var import_promises = require("node:readline/promises");
var import_node_process = require("node:process");

// src/shared/config.ts
var fs3 = __toESM(require("node:fs"), 1);
var path3 = __toESM(require("node:path"), 1);
var crypto = __toESM(require("node:crypto"), 1);

// src/shared/runtime-paths.ts
var fs = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);
function resolveRuntimePaths(extensionDir) {
  const runtimeDir = path.join(extensionDir, ".gemini-discord");
  return {
    runtimeDir,
    bindingsDir: path.join(runtimeDir, "bindings"),
    managedConfigFile: resolveManagedRuntimePath(extensionDir, "config.json"),
    daemonTokenFile: resolveManagedRuntimePath(extensionDir, "daemon-token", ".daemon-token"),
    daemonLogFile: resolveManagedRuntimePath(extensionDir, "daemon.log", "daemon.log"),
    memoryFile: resolveManagedRuntimePath(extensionDir, "memory.json", ".memory.json"),
    memoryTmpFile: resolveManagedRuntimePath(extensionDir, "memory.json.tmp", ".memory.json.tmp"),
    cronFile: resolveManagedRuntimePath(extensionDir, "cron.json", ".cron.json"),
    dmPairingsFile: path.join(runtimeDir, "dm-pairings.json")
  };
}
function ensureRuntimePaths(extensionDir) {
  const paths = resolveRuntimePaths(extensionDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.mkdirSync(paths.bindingsDir, { recursive: true });
  return paths;
}
function resolveManagedRuntimePath(extensionDir, runtimeRelativePath, legacyFileName) {
  const runtimeDir = path.join(extensionDir, ".gemini-discord");
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

// src/shared/managed-config.ts
var fs2 = __toESM(require("node:fs"), 1);
var path2 = __toESM(require("node:path"), 1);
var MANAGED_CONFIG_VERSION = 2;
function readManagedConfigFile(filePath) {
  if (!fs2.existsSync(filePath)) {
    return createManagedConfigFile();
  }
  try {
    const parsed = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
    if (parsed.version === 1 && typeof parsed.values === "object" && parsed.values !== null) {
      return createManagedConfigFile(coerceStringMap(parsed.values));
    }
    if (parsed.version === MANAGED_CONFIG_VERSION) {
      return {
        version: MANAGED_CONFIG_VERSION,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : (/* @__PURE__ */ new Date()).toISOString(),
        env: coerceStringMap(parsed.env),
        discord: coerceDiscordMetadata(parsed.discord)
      };
    }
  } catch {
  }
  return createManagedConfigFile();
}
function writeManagedConfigFile(filePath, config) {
  const payload = {
    version: MANAGED_CONFIG_VERSION,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    env: coerceStringMap(config.env),
    discord: coerceDiscordMetadata(config.discord)
  };
  fs2.mkdirSync(path2.dirname(filePath), { recursive: true });
  fs2.writeFileSync(filePath, JSON.stringify(payload, null, 2), { mode: 384 });
}
function updateManagedConfigFile(filePath, updater) {
  const next = updater(readManagedConfigFile(filePath));
  writeManagedConfigFile(filePath, next);
  return next;
}
function createManagedConfigFile(env = {}) {
  return {
    version: MANAGED_CONFIG_VERSION,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    env: coerceStringMap(env),
    discord: {}
  };
}
function coerceStringMap(input2) {
  if (!input2 || typeof input2 !== "object") {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(input2)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
function coerceDiscordMetadata(input2) {
  if (!input2 || typeof input2 !== "object") {
    return {};
  }
  const result = {};
  const fields = [
    "primaryGuildId",
    "primaryGuildName",
    "primaryChannelId",
    "primaryChannelName",
    "botUserId",
    "botTag",
    "appOwnerId",
    "appOwnerTag",
    "lastConnectedAt"
  ];
  for (const field of fields) {
    const value = input2[field];
    if (typeof value === "string" && value.trim()) {
      result[field] = value;
    }
  }
  return result;
}

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
function parseEnvFile(filePath) {
  const result = {};
  if (!fs3.existsSync(filePath)) return result;
  const content = fs3.readFileSync(filePath, "utf-8");
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
function parseBoolean(value, fallback) {
  if (value === void 0 || value === "") return fallback;
  return value.toLowerCase() === "true";
}
function parseMemoryScope(value) {
  return value === "channel" ? "channel" : "global";
}
function parseGeminiSessionBindingScope(value) {
  switch (value) {
    case "global":
    case "server":
    case "channel":
      return value;
    default:
      return "channel";
  }
}
function resolveAdminId(explicitAdminId, ownerIds) {
  const explicit = explicitAdminId?.trim();
  if (explicit) {
    return explicit;
  }
  if (ownerIds.length === 1) {
    return ownerIds[0];
  }
  return ownerIds[0] ?? "";
}
function normalizeConfigMap(input2) {
  const normalized = {};
  for (const key of CONFIG_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input2, key) && input2[key].trim() !== "") {
      normalized[key] = input2[key];
      continue;
    }
    const aliases = LEGACY_ENV_ALIASES[key] ?? [];
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(input2, alias) && input2[alias].trim() !== "") {
        normalized[key] = input2[alias];
        break;
      }
    }
  }
  return normalized;
}
function collectProcessEnv() {
  const result = {};
  for (const key of CONFIG_ENV_KEYS) {
    const value = process.env[key];
    if (value !== void 0) {
      result[key] = value;
    }
    const aliases = LEGACY_ENV_ALIASES[key] ?? [];
    for (const alias of aliases) {
      const aliasValue = process.env[alias];
      if (aliasValue !== void 0 && result[key] === void 0) {
        result[key] = aliasValue;
      }
    }
  }
  return result;
}
function resolveConfigEnvMap(extensionDir) {
  const runtimePaths = ensureRuntimePaths(extensionDir);
  const managedConfig = readManagedConfigFile(runtimePaths.managedConfigFile);
  const snapshotVars = normalizeConfigMap(managedConfig.env);
  const processVars = normalizeConfigMap(collectProcessEnv());
  const fileVars = normalizeConfigMap(parseEnvFile(path3.join(extensionDir, ".env")));
  const resolved = {
    ...fileVars,
    ...snapshotVars,
    ...processVars
  };
  try {
    persistManagedConfig(runtimePaths.managedConfigFile, managedConfig, resolved);
  } catch {
  }
  return resolved;
}
function loadConfig(extensionDir) {
  const envVars = resolveConfigEnvMap(extensionDir);
  const runtimePaths = ensureRuntimePaths(extensionDir);
  const managedConfig = readManagedConfigFile(runtimePaths.managedConfigFile);
  const get = (key, fallback = "") => {
    const envValue = envVars[key];
    return envValue === void 0 ? fallback : envValue;
  };
  const ownerIds = splitIds(get(ENV.DISCORD_OWNER_IDS));
  const primaryChannelId = get(ENV.DISCORD_CHANNEL_ID);
  const configuredServerId = get(ENV.DISCORD_SERVER_ID);
  const configuredAllowedChannelIds = splitIds(get(ENV.DISCORD_ALLOWED_CHANNEL_IDS));
  const allowedUserIds = splitIds(get(ENV.DISCORD_ALLOWED_USER_IDS));
  const hasInstallSettings = Boolean(
    get(ENV.DISCORD_BOT_TOKEN).trim() && get(ENV.DISCORD_OWNER_IDS).trim() && get(ENV.DISCORD_SERVER_ID).trim()
  );
  const config = {
    discordBotToken: get(ENV.DISCORD_BOT_TOKEN),
    discordChannelId: primaryChannelId,
    discordServerId: configuredServerId || managedConfig.discord.primaryGuildId || "",
    discordServerName: managedConfig.discord.primaryGuildName ?? "",
    discordBossUserId: get(ENV.DISCORD_BOSS_USER_ID).trim(),
    ownerIds,
    discordAdminId: resolveAdminId(get(ENV.DISCORD_ADMIN_ID), ownerIds),
    allowedChannelIds: configuredAllowedChannelIds.length > 0 ? configuredAllowedChannelIds : primaryChannelId ? [primaryChannelId] : [],
    allowedUserIds: allowedUserIds.length > 0 ? allowedUserIds : ownerIds,
    allowedAgentIds: splitIds(get(ENV.DISCORD_ALLOWED_AGENT_IDS)),
    daemonApiToken: (() => {
      let token = get(ENV.DAEMON_API_TOKEN);
      if (token) return token;
      const tokenPath = runtimePaths.daemonTokenFile;
      if (fs3.existsSync(tokenPath)) {
        return fs3.readFileSync(tokenPath, "utf-8").trim();
      }
      token = crypto.randomBytes(32).toString("hex");
      try {
        fs3.writeFileSync(tokenPath, token, { mode: 384 });
      } catch (e) {
      }
      return token;
    })(),
    discordPrefix: get(ENV.DISCORD_PREFIX),
    discordResetCmd: get(ENV.DISCORD_RESET_CMD, "!reset"),
    daemonPort: parseInt(get(ENV.DAEMON_PORT, "18790"), 10),
    geminiPath: get(ENV.GEMINI_PATH, "gemini"),
    geminiModel: get(ENV.GEMINI_MODEL, "gemini-3.1-flash-lite-preview"),
    geminiTimeoutMs: parseInt(get(ENV.GEMINI_TIMEOUT_MS, "900000"), 10),
    geminiMaxConcurrent: parseInt(get(ENV.GEMINI_MAX_CONCURRENT, "3"), 10),
    conversationHistoryLength: parseInt(get(ENV.CONVERSATION_HISTORY_LENGTH, "30"), 10),
    promptHistoryMessageLimit: parseInt(get(ENV.PROMPT_HISTORY_MAX_MESSAGES, "12"), 10),
    promptHistoryCharBudget: parseInt(get(ENV.PROMPT_HISTORY_MAX_CHARS, "6000"), 10),
    streaming: parseBoolean(get(ENV.STREAMING, "true"), true),
    queueMaxDepth: parseInt(get(ENV.QUEUE_MAX_DEPTH, "20"), 10),
    enableDMs: parseBoolean(get(ENV.ENABLE_DMS, "true"), true),
    requireMention: parseBoolean(get(ENV.REQUIRE_MENTION, "true"), true),
    respondToReplies: parseBoolean(get(ENV.RESPOND_TO_REPLIES, "true"), true),
    memoryScope: parseMemoryScope(get(ENV.MEMORY_SCOPE, "channel")),
    autoStartDaemon: parseBoolean(get(ENV.AUTO_START_DAEMON, "true"), true),
    useGeminiCliSessions: parseBoolean(get(ENV.USE_GEMINI_CLI_SESSIONS, "true"), true),
    geminiSessionBindingScope: parseGeminiSessionBindingScope(get(ENV.GEMINI_SESSION_BINDING_SCOPE, "channel")),
    cliIdleTimeoutMs: parseInt(get(ENV.CLI_IDLE_TIMEOUT_MS, "300000"), 10),
    setupValidationPending: parseBoolean(
      get(ENV.SETUP_VALIDATION_PENDING, hasInstallSettings ? "true" : "false"),
      false
    )
  };
  return config;
}
function resolveExtensionDir(fromDir) {
  let dir = fromDir;
  if (dir.startsWith("file://")) {
    dir = path3.dirname(new URL(dir).pathname);
  }
  if (path3.basename(dir) === "dist") {
    return path3.dirname(dir);
  }
  let current = dir;
  while (current !== path3.dirname(current)) {
    if (fs3.existsSync(path3.join(current, "gemini-extension.json"))) {
      return current;
    }
    current = path3.dirname(current);
  }
  return dir;
}
function persistManagedConfig(filePath, current, values) {
  updateManagedConfigFile(filePath, () => ({
    ...current,
    env: normalizeConfigMap(values)
  }));
}

// src/shared/daemon-runtime.ts
var fs4 = __toESM(require("node:fs"), 1);
var http = __toESM(require("node:http"), 1);
var path4 = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");
var startupPromise = null;
var HEALTH_POLL_MS = 500;
var STOP_TIMEOUT_MS = 45e3;
async function ensureDaemonRunning(config, extensionDir) {
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
async function shutdownDaemon(config) {
  if (!await isDaemonHealthy(config.daemonPort)) {
    return;
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: config.daemonPort,
        path: "/shutdown",
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.daemonApiToken}`,
          "Content-Length": 0
        }
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`shutdown_failed_status_${res.statusCode}`));
        }
      }
    );
    req.on("error", (err) => reject(err));
    req.end();
  });
}
async function restartDaemon(config, extensionDir, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? HEALTH_POLL_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const wasHealthy = await isDaemonHealthy(config.daemonPort);
  const previousStartedAt = wasHealthy ? await getDaemonStartedAt(config) : null;
  if (wasHealthy) {
    await shutdownDaemon(config);
    const stopped = await waitForHealthState(config.daemonPort, false, stopTimeoutMs, pollIntervalMs);
    if (!stopped) {
      throw new Error("daemon_failed_to_stop");
    }
  }
  await ensureDaemonRunning(config, extensionDir);
  if (wasHealthy && previousStartedAt) {
    const restarted = await waitForNewStartTime(config, previousStartedAt, stopTimeoutMs, pollIntervalMs);
    if (!restarted) {
      throw new Error("daemon_restart_not_observed");
    }
  }
}
async function isDaemonHealthy(port) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        method: "GET",
        timeout: 1500
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
async function startDaemonProcess(config, extensionDir) {
  const daemonEntry = path4.join(extensionDir, "dist", "daemon.cjs");
  const logPath = resolveRuntimePaths(extensionDir).daemonLogFile;
  const outFd = fs4.openSync(logPath, "a");
  const errFd = fs4.openSync(logPath, "a");
  const child = (0, import_node_child_process.spawn)(process.execPath, [daemonEntry], {
    cwd: extensionDir,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: { ...process.env }
  });
  child.unref();
  const started = await waitForHealth(config.daemonPort, 15e4);
  if (!started) {
    throw new Error("daemon_failed_to_start");
  }
}
async function waitForHealth(port, timeoutMs) {
  return waitForHealthState(port, true, timeoutMs, HEALTH_POLL_MS);
}
async function waitForHealthState(port, shouldBeHealthy, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isDaemonHealthy(port) === shouldBeHealthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}
async function getDaemonStartedAt(config) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: config.daemonPort,
        path: "/status",
        method: "GET",
        timeout: 2e3
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            resolve(typeof parsed.startedAt === "string" ? parsed.startedAt : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}
async function waitForNewStartTime(config, previousStartedAt, timeoutMs, pollIntervalMs) {
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

// scripts/setup.ts
async function main() {
  let tmpDir = process.cwd();
  try {
    tmpDir = __dirname;
  } catch {
  }
  const extensionDir = resolveExtensionDir(tmpDir);
  const rl = (0, import_promises.createInterface)({ input: import_node_process.stdin, output: import_node_process.stdout });
  try {
    import_node_process.stdout.write("gemini-discord setup\n");
    import_node_process.stdout.write(`Extension directory: ${extensionDir}

`);
    const setupInput = validateSetupInput(await promptForSetupInput(rl));
    writeSetupConfig(extensionDir, setupInput);
    installDependencies(extensionDir);
    buildExtension(extensionDir);
    await restartDaemon(loadConfig(extensionDir), extensionDir);
    import_node_process.stdout.write("\nSetup complete. A Discord DM confirmation will be sent when the bot finishes startup.\n");
  } finally {
    rl.close();
  }
}
async function promptForSetupInput(rl) {
  const botToken = (await rl.question("Bot Token: ")).trim();
  const userId = (await rl.question("Boss User ID: ")).trim();
  const serverId = (await rl.question("Server ID: ")).trim();
  return { botToken, userId, serverId };
}
function validateSetupInput(input2) {
  const botToken = input2.botToken.trim();
  const userId = input2.userId.trim();
  const serverId = input2.serverId.trim();
  if (!botToken) {
    throw new Error("Bot Token is required.");
  }
  if (!isDiscordSnowflake(userId)) {
    throw new Error("Boss User ID must be a Discord numeric snowflake.");
  }
  if (!isDiscordSnowflake(serverId)) {
    throw new Error("Server ID must be a Discord numeric snowflake.");
  }
  return { botToken, userId, serverId };
}
function buildSetupEnv(input2) {
  return {
    [ENV.DISCORD_BOT_TOKEN]: input2.botToken,
    [ENV.DISCORD_SERVER_ID]: input2.serverId,
    [ENV.DISCORD_BOSS_USER_ID]: input2.userId,
    [ENV.DISCORD_OWNER_IDS]: input2.userId,
    [ENV.DISCORD_ADMIN_ID]: input2.userId,
    [ENV.DISCORD_ALLOWED_USER_IDS]: input2.userId,
    ...SETUP_RUNTIME_DEFAULTS
  };
}
function writeSetupConfig(extensionDir, input2) {
  const paths = ensureRuntimePaths(extensionDir);
  const setupEnv = buildSetupEnv(input2);
  updateManagedConfigFile(paths.managedConfigFile, (current) => {
    const env = { ...current.env };
    for (const key of SETUP_ENV_KEYS_TO_CLEAR) {
      delete env[key];
    }
    return {
      ...current,
      env: {
        ...env,
        ...setupEnv
      },
      discord: {
        ...current.discord,
        primaryGuildId: input2.serverId
      }
    };
  });
}
function installDependencies(extensionDir) {
  if (!fs5.existsSync(path5.join(extensionDir, "package.json"))) {
    return;
  }
  const args = fs5.existsSync(path5.join(extensionDir, "package-lock.json")) ? ["ci"] : ["install"];
  (0, import_node_child_process2.execFileSync)(npmCommand(), args, {
    cwd: extensionDir,
    stdio: "inherit"
  });
}
function buildExtension(extensionDir) {
  if (!fs5.existsSync(path5.join(extensionDir, "package.json"))) {
    return;
  }
  (0, import_node_child_process2.execFileSync)(npmCommand(), ["run", "build"], {
    cwd: extensionDir,
    stdio: "inherit"
  });
}
function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
function isDiscordSnowflake(value) {
  return /^\d{15,25}$/.test(value);
}
function isMainModule() {
  const entry = process.argv[1];
  if (!entry || process.env["VITEST"]) {
    return false;
  }
  const entryName = path5.basename(entry);
  return entryName === "setup.cjs" || entryName === "setup.ts";
}
if (isMainModule()) {
  main().catch((err) => {
    process.stderr.write(`gemini-discord setup failed: ${err instanceof Error ? err.message : String(err)}
`);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSetupEnv,
  promptForSetupInput,
  validateSetupInput,
  writeSetupConfig
});
