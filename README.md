# gemini-discord

Your local Gemini CLI agent, reachable from Discord.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-extension-4285F4.svg)](https://github.com/google-gemini/gemini-cli)
[![MCP](https://img.shields.io/badge/protocol-MCP-blueviolet.svg)](https://modelcontextprotocol.io)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-22%2B-green.svg)](https://nodejs.org)

`gemini-discord` connects your Discord app to [Gemini CLI](https://github.com/google-gemini/gemini-cli), providing a chat interface for your agent. Using the CLI's native **Agent Client Protocol (ACP)** mode, it lets you manage sessions, automate tasks, and interact with your agent via Discord DMs or server channels.

Send a task from your phone. Your agent picks it up, works in the same workspace, and replies in the same channel. Sessions stay warm. Credentials stay local. Authority stays with one Discord user ID you control.

---

## Discord Bot Setup

You need a bot application before installing:

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications).
2. Go to **Bot** → Reset Token → copy it. This is `DISCORD_BOT_TOKEN`.
3. Enable **Message Content Intent** (required) and **Server Members Intent** (required by default; requested unless `DISCORD_ENABLE_SERVER_MEMBERS_INTENT` is set to `false`). Ensure both are toggled ON in the Developer Portal under the **Bot** tab.
4. Go to **OAuth2 → URL Generator**. Scopes: `bot`, `applications.commands`. Minimum permissions: View Channels, Read Message History, Send Messages, Attach Files, Use Slash Commands, Add Reactions.
5. Open the generated URL to invite the bot to your server.
6. Enable Developer Mode in Discord (Settings → Advanced), then right-click your username and copy your User ID. This is `DISCORD_BOSS_USER_ID`.

---

## Install

Requires [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated, Node.js 22+, and a Discord bot token.

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

The installer prompts for three values. Restart Gemini CLI and the bot should come online.

| Prompt | What it is |
| --- | --- |
| Discord Bot Token | From the Discord Developer Portal |
| Boss User ID | Your stable numeric Discord user ID — the only ID with full authority |
| Server ID | The server where the bot is installed |

Legacy owner and admin routing IDs are auto-derived from Boss User ID unless overridden in [advanced configuration](docs/configuration.md).

---

## Updating Configuration

To rotate credentials or update setup values:

```bash
gemini extensions config gemini-discord
```

For local development:

```bash
npm run setup
```

---

## What it can do

**From Discord, you can:**
- Chat with your agent in any channel, thread, or DM
- Send attachments — images, video, audio, PDFs, text, Markdown, JSON, source files — and the agent receives them in-session
- Trigger scheduled tasks and cron jobs
- Search local media files and post them back when authorized

**Your agent gains Discord tools:**

| Tool | Actions |
| --- | --- |
| `discord_message` | Send, reply, edit, delete, react, fetch reactions, pin, unpin |
| `discord_admin` | Status, restart, reset sessions, discover channels/users, set presence, kick, timeout |
| `discord_history` | Read recent exchanges and archived sessions |
| `discord_cron` | Schedule and manage reminders and recurring jobs |
| `discord_find_media` | Search host machine media and post to Discord |

**Slash commands:**

| Command | Description |
| --- | --- |
| `/new` | Fresh session for the current channel |
| `/status` | Daemon health and runtime info |
| `/model` | Switch Gemini model (boss only) |
| `/pool` | Process pool state (boss only) |
| `/kill` | Kill a pooled process (boss only) |
| `/ping` | Round-trip latency |

---

## Permissions

Two roles: `BOSS` and `GUEST`.

**Boss** authority is granted only by `DISCORD_BOSS_USER_ID` — never by username, display name, role, server owner status, or any other Discord metadata. If that value is missing or malformed, privileged actions fail closed.

**Guests** are globally disabled by default. Human users in `DISCORD_ALLOWED_USER_IDS` can chat in allowed channels even when `DISCORD_ENABLE_GUESTS=false`; other human users can chat only when `DISCORD_ENABLE_GUESTS=true`. When available, simple public Google Search may be allowed for guests. They cannot use MCP tools, shell access, filesystem access, attachment processing, history, discovery, cron, admin, moderation, or outbound Discord actions. Peer bots remain separate and must be listed in `DISCORD_ALLOWED_AGENT_IDS`.

All message sends require an explicit target. If a target can't be proven, the action fails — there is no fallback channel.

Credentials and runtime state stay local. Do not commit `.env`, `.gemini-discord/`, logs, databases, tokens, or real Discord IDs.

---

## Configuration

Most users only need the install prompts. Full reference via [docs/configuration.md](docs/configuration.md).

| Prompt | Purpose |
| --- | --- |
| Discord Bot Token | Lets the bridge connect to Discord |
| Boss User ID | The only Discord user ID with full authority |
| Server ID | Server where the bot is installed |

Update these later with:

```bash
gemini extensions config gemini-discord
```

**Agent instructions:** This extension does not ship a `GEMINI.md`. Keep your agent instructions in `~/.gemini/GEMINI.md`. The bridge adds only transport context — message metadata, channel/thread/DM scope, attachment refs, and permission metadata.

---

## Development

```bash
git clone https://github.com/Yamato-main/gemini-discord
cd gemini-discord
npm install && npm run setup && npm run build
```

Install a local path:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

```bash
npm run typecheck       # Type-check
npm test                # Run tests
npm run dev:daemon      # Daemon in dev mode
npm run start:daemon    # Start daemon
npm run start:server    # Start MCP server
npm run install-service # Install as system service
```

Before releasing: run typecheck + tests + build, commit `dist/`, keep `.env` and `.gemini-discord/` untracked, use placeholder IDs in examples, add the `gemini-cli-extension` GitHub topic.

---

## Troubleshooting

### Disallowed Intents (Close Code 4014)
If the daemon log shows a `Fatal disconnect (code 4014)` or the probe logs a warning about missing intents:
1. Ensure both **Message Content Intent** and **Server Members Intent** are enabled in the Discord Developer Portal under the **Bot** settings page.
2. If you do not want to enable the Server Members Intent, add `DISCORD_ENABLE_SERVER_MEMBERS_INTENT=false` to your configuration (either in `.env` or using config tool). The daemon will automatically detect missing portal permissions and fall back to disabling this intent to connect successfully.

### Invalid Bot Token (Close Code 4004)
If you see a `Fatal disconnect (code 4004)`:
1. The Discord token configured in your setup is invalid or expired.
2. Reset your token in the Discord Developer Portal and update your configuration.

### Log Files
To view detailed logs for diagnostic purposes, look at:
- `.gemini-discord/daemon.log` inside the extension installation directory.

---

## Security Warning: Plaintext Token Storage
> [!CAUTION]
> **Plaintext Bot Token Exposure**: The extension stores `DISCORD_BOT_TOKEN` in plaintext inside the `.gemini-discord/config.json` managed configuration file. While `.gemini-discord/` is ignored by git, anyone with local access to the file system can read this token. Keep your system secure and do not share your extension data directory.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

