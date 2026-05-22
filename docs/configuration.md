# Configuration Reference

This document provides a full reference for all environment variables supported by `gemini-discord`.

Most users only need to configure the three core values during installation. For advanced tuning, you can update your `.env` file or use `gemini extensions config gemini-discord`.

## Core Settings (Set During Install)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | - | **Required.** Your Discord bot application token. |
| `DISCORD_BOSS_USER_ID` | - | **Required.** Your numeric Discord User ID. This is the only user with full authority over the bridge. |
| `DISCORD_SERVER_ID` | - | **Required.** The ID of the Discord server where the bot operates. |

## Advanced Identity & Access

These are auto-derived from the core settings above unless explicitly overridden.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_OWNER_IDS` | *(derived from `DISCORD_BOSS_USER_ID`)* | Comma-separated list of Discord User IDs for legacy routing. Auto-derived from Boss User ID when absent. **Does not grant Boss authority.** |
| `DISCORD_ADMIN_ID` | *(derived from owner IDs)* | ID for admin-specific notifications. Defaults to the first owner ID (i.e. Boss User ID). |
| `DISCORD_ENABLE_GUESTS` | `false` | Set to `true` to allow non-boss, non-allowlisted human users to interact with the bot. |
| `DISCORD_ENABLE_SERVER_MEMBERS_INTENT` | `true` | Set to `false` to disable the Server Members gateway intent. This avoids the need to enable the Server Members Intent toggle in the Discord Developer Portal, but limits user discovery and dynamic name pairing. The daemon automatically falls back to `false` if it detects that the Developer Portal toggle is disabled. |
| `DISCORD_CHANNEL_ID` | - | Optional. Primary channel for daemon startup notifications. Auto-discovered on first connect. |
| `DISCORD_ALLOWED_CHANNEL_IDS`| - | Comma-separated list of channel IDs where the bot is allowed to respond. Leave blank to allow all channels in `DISCORD_SERVER_ID`; this is not derived from `DISCORD_CHANNEL_ID`. |
| `DISCORD_ALLOWED_USER_IDS` | - | Comma-separated list of human user IDs allowed to interact with the bot even when `DISCORD_ENABLE_GUESTS=false`. Empty means no allowlisted humans. |
| `DISCORD_ALLOWED_AGENT_IDS` | - | Comma-separated list of peer bot IDs allowed to trigger this agent. |

## Engine Defaults

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAEMON_PORT` | `18790` | Localhost port for the daemon control API. |
| `GEMINI_PATH` | `gemini` | Command or path to the Gemini CLI executable. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite-preview` | The Gemini model to use for conversations. |
| `GEMINI_TIMEOUT_MS` | `900000` | Network timeout (ms) for Gemini CLI calls. |
| `GEMINI_MAX_CONCURRENT` | `3` | Maximum number of concurrent warm Gemini CLI processes in the pool. |
| `CONVERSATION_HISTORY_LENGTH` | `30` | Number of messages to keep in the short-term conversation buffer. |
| `PROMPT_HISTORY_MAX_MESSAGES` | `12` | Max messages from history to include in the context prompt. |
| `PROMPT_HISTORY_MAX_CHARS` | `6000` | Max characters from history to include in the context prompt. |
| `CLI_IDLE_TIMEOUT_MS` | `300000` | How long (ms) a pooled CLI process stays warm while idle. |
| `STREAMING` | `true` | Enable/disable streaming responses and typing indicators. |
| `QUEUE_MAX_DEPTH` | `20` | Maximum number of tasks that can be queued per conversation. |
| `ENABLE_DMS` | `true` | Whether the bot should respond to Direct Messages. |
| `REQUIRE_MENTION` | `false` | If true, the bot only responds in servers when explicitly mentioned. |
| `RESPOND_TO_REPLIES` | `true` | Whether the bot should respond to direct replies to its messages. |
| `MEMORY_SCOPE` | `channel` | Isolation level for Discord memory (`channel` or `global`). |
| `AUTO_START_DAEMON` | `true` | Automatically start the Discord daemon when the MCP server is initialized. |
| `USE_GEMINI_CLI_SESSIONS` | `true` | Use native Gemini CLI session management. |
| `GEMINI_SESSION_BINDING_SCOPE`| `channel` | Isolation level for Gemini CLI sessions (`channel`, `server`, or `global`). |

## Internal

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAEMON_API_TOKEN` | - | Internal token for daemon/server communication (auto-generated). |

## Updating Configuration

To update core values:

```bash
gemini extensions config gemini-discord
```

To modify advanced values, edit the `.env` file in your extension directory or use the `npm run setup` command for local development.
