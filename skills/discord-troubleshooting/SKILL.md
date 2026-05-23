---
name: discord-troubleshooting
description: Troubleshoots and resolves gemini-discord bot connection, gateway issues (e.g. fatal disconnects 4014, 4004), and port conflicts. Ensures the bot gets online and operational by running loops to verify success.
---

## Core Concepts

When the `gemini-discord` extension is installed, the bot might fail to connect due to missing Discord Developer Portal settings, an invalid bot token, or local networking conflicts.

This skill provides a systematic diagnosis and resolution flow to ensure the bot is successfully connected and online.

## Workflow Patterns

### 1. Diagnose Gateway Status

Start by checking if the daemon is running and what its current status is:
1. Read the daemon log file at `.gemini-discord/daemon.log` (relative to the extension installation directory).
2. Look for the last startup sequence and any errors, specifically gateway close codes or startup failures:
   - **4014 (Disallowed Intents)**: The bot is requesting privileged intents (Message Content and/or Server Members) that are not enabled in the Discord Developer Portal.
   - **4004 (Invalid Token)**: The configured `DISCORD_BOT_TOKEN` is invalid or expired.
   - **Port in use**: The daemon logs `Port <number> in use, trying next...` or older installs fail with `❌ ERROR Port in use. Is the daemon already running?`.
   - **ECONNREFUSED**: The daemon control API server is not running or unreachable on its configured port.

### 2. Resolve Intent Issues (4014 / Disallowed Intents)

If you identify a 4014 disconnect code, you have two options to resolve it:

#### Option A: Frictionless Fallback (Recommended First Step)
Disabling the optional Server Members Intent in your configuration bypasses the requirement to toggle it in the developer portal:
1. Update `.env` or configuration to include:
   ```env
   DISCORD_ENABLE_SERVER_MEMBERS_INTENT=false
   ```
2. Restart the daemon. The bot will connect successfully as long as the Message Content Intent is enabled.
*Note: The daemon now includes automatic pre-flight probe validation and will dynamically fall back to false if the portal toggle is missing.*

#### Option B: Guide User to Enable Intents in Portal
If the Message Content Intent itself is missing, the bot *cannot* connect and you must instruct the user:
1. Tell the user to go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select their bot application and click on the **Bot** tab on the left sidebar.
3. Scroll down to the **Privileged Gateway Intents** section.
4. Toggle on **Message Content Intent** (Mandatory) and **Server Members Intent** (Optional but enabled by default in configuration).
5. Save changes.

### 3. Resolve Port Conflicts

If you identify a port conflict:
1. Read `.gemini-discord/daemon.log` and check whether the daemon recovered with `Control API listening` on a later port.
2. Read `.gemini-discord/daemon.port` to find the active control API port used by MCP tools.
3. If the bot is connected but MCP tools still report `daemon_offline`, restart the Gemini CLI session so the MCP server reloads runtime state.
4. For older installs that still exit on port conflicts, check if another instance is already running with `ps -ef | grep node`.
5. Only change `DAEMON_PORT` in `.env` and `.gemini-discord/config.json` if the user needs a stable preferred port. Do not edit `gemini-extension.json` for routine conflicts now that MCP clients discover `.gemini-discord/daemon.port`.

### 4. Resolve Token Issues (4004 / Invalid Token)

If you identify a 4004 disconnect code:
1. Ask the user to verify their bot token or generate a new one in the **Bot** tab of their developer portal application.
2. Update the `DISCORD_BOT_TOKEN` variable in the `.env` file with the correct token.
3. Restart the daemon.

### 5. Verification Loop (Crucial)

**IMPORTANT: Do not assume the bot works after making changes. Loop and check status until verified.**

Execute this loop:
1. Propose/run the daemon restart command:
   ```bash
   npm run build && npm run start:daemon
   ```
2. Set a 5-second timer or reminder, then read the trailing 50 lines of `.gemini-discord/daemon.log`.
3. Check if the log shows `Discord bot connected` or `Daemon ready`.
4. If it still fails with a fatal gateway code or port error, identify the new failure and repeat the diagnostic/resolution flow. Do not stop until the connection successfully establishes or is blocked awaiting user portal updates.
