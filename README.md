# gemini-discord ⛩️

**Yamato-samurai's gateway between Gemini CLI and Discord.**

`gemini-discord` is a Gemini CLI extension inspired by Openclaw's Discord experience, but shaped around Gemini CLI and Yamato's own design language. It runs a persistent Discord daemon plus an MCP bridge so you can:

- talk to your Gemini agent from Discord channels or DMs,
- send Discord images straight into Gemini CLI for multimodal replies,
- bind a persistent Gemini CLI session to a server or DM,
- keep one persistent memory across the whole configured server,
- let the agent keep speaker identity straight across channels,
- safely allow conversations with selected peer agents/bots,
- send messages back into Discord from Gemini CLI tools.

## What Changed

- **Daemon auto-start:** the MCP side now brings the Discord daemon up automatically when needed.
- **Real setup flow:** `npm run setup` now writes `.env`, generates the API token, and can install a macOS `launchd` service.
- **Global transcript memory:** memory now stores speaker, channel, guild, trigger, and message metadata instead of flattening everything into anonymous "User" lines.
- **Peer agent routing:** selected Discord bot IDs can talk to Yamato-samurai without opening the door to every bot in the server.
- **Discord image intake:** image attachments are downloaded to local temp files and injected into the Gemini prompt for multimodal understanding.
- **Usable history tooling:** `discord_history` now includes request/reply message IDs so `discord_reply` is actually practical.

## Architecture

- **Track 1: Discord daemon**
  Owns the Discord client, queue, persistent memory, Gemini CLI invocation, and localhost control API.

- **Track 2: Gemini CLI extension / MCP server**
  Registers tools like `discord_send`, `discord_reply`, and `discord_history`, and can auto-start the daemon if it is offline.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Run setup:
   ```bash
   npm run setup
   ```

4. Link it into Gemini CLI:
   ```bash
   gemini extensions link .
   ```

5. If you skipped `launchd`, start the daemon manually:
   ```bash
   npm run start:daemon
   ```

## Configuration Highlights

- `ALLOWED_CHANNEL_IDS`
  Channels the daemon is allowed to listen to and the tools are allowed to write to.

- `DISCORD_ALLOWED_USER_IDS`
  Human speakers allowed to talk to the agent. If blank, it falls back to `DISCORD_OWNER_IDS`.

- `DISCORD_ALLOWED_AGENT_IDS`
  Peer bot IDs allowed to converse with Yamato-samurai.

- `MEMORY_SCOPE`
  `channel` is the better latency default because it avoids serializing the whole server behind one queue.
  `global` keeps one persistent memory across the whole configured Discord space.

- `USE_GEMINI_CLI_SESSIONS`
  Keep this `false` for fast chat-style replies. Turning it `true` reuses Gemini CLI sessions, but it can also make Discord turns slower and more agentic.

- `GEMINI_SESSION_BINDING_SCOPE`
  `channel` is the safer default for responsiveness.
  `server` binds one Gemini session per guild and one per DM user.
  `global` binds everything into one Gemini session.

- `PROMPT_HISTORY_MAX_MESSAGES` / `PROMPT_HISTORY_MAX_CHARS`
  Limit how much of the stored transcript is replayed into Gemini for each turn.
  This is the main latency control when you want long-lived memory without replaying an entire server transcript.

- `REQUIRE_MENTION`
  When `true`, guild messages must mention the bot, use the prefix, or reply to the bot.

## Tools

- `discord_status`
  Shows daemon health, memory scope, and allowlist/routing state.

- `discord_send`
  Sends a message to an allowed guild channel or enabled DM target.

- `discord_reply`
  Replies to a specific message ID in Discord.

- `discord_history`
  Returns recent exchanges, participant/channel context, and message IDs for follow-up replies.

- `discord_reset`
  Clears the active memory session.

- `discord_restart`
  Restarts the daemon after configuration or runtime issues.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Notes

- The daemon uses a single queue when memory is `global`, which prevents cross-channel race conditions from corrupting the shared transcript.
- For lowest latency, keep `USE_GEMINI_CLI_SESSIONS=false`, `MEMORY_SCOPE=channel`, and `GEMINI_SESSION_BINDING_SCOPE=channel`.
- Large `CONVERSATION_HISTORY_LENGTH` values are now safer because prompt replay is bounded by `PROMPT_HISTORY_MAX_MESSAGES` and `PROMPT_HISTORY_MAX_CHARS`.
- macOS users can install the daemon as a background service through the setup wizard.
- Discord rate limiting is retried automatically, and daemon memory is persisted atomically to `.memory.json`.
