# gemini-discord

Give your existing local [Gemini CLI](https://geminicli.com) agent a Discord channel.

This is not a hosted bot and not a separate Discord persona. It runs Gemini CLI locally and passes Discord messages into that same agent with just enough context for it to know it is speaking inside Discord.

## Install

Prerequisites:

- Node.js 22+
- Gemini CLI installed and authenticated
- A Discord bot token
- Discord Message Content intent enabled for the bot

Install from GitHub:

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

Install from a local checkout while developing:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

During install, Gemini CLI asks for:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID` (optional override)
- `DISCORD_OWNER_IDS` (optional override)

After install, open or restart Gemini CLI once. The MCP server will start the local Discord daemon automatically, and the bot should come online.

If you leave the channel or owner fields blank, `gemini-discord` now auto-manages them for you:

- The effective install/runtime config is written to `.gemini-discord/config.json`
- The bot tries to infer the Discord application owner automatically
- If the bot is only in one server, it can prefill that server and its visible text channels
- The first owner message in a server channel becomes the remembered primary channel

In practice, most GitHub installs only need the bot token plus inviting the bot to your server.

To change settings later:

```bash
gemini extensions config gemini-discord
```

## What It Does

`gemini-discord` connects Discord to Gemini CLI:

- Discord messages are sent to Gemini CLI
- Gemini replies stream back into Discord
- Image attachments are passed to Gemini as local file references
- `/new` starts a fresh Gemini session for the current Discord binding
- The agent can schedule both recurring cron jobs and simple "remind me in X minutes/hours/days" reminders
- The agent can use Discord tools when explicitly asked to send, reply, read history, reset, schedule, or inspect channels

The extension only adds Discord awareness. It tells Gemini that the incoming message is from Discord, that normal text output goes back to the current Discord conversation, and that Discord-compatible Markdown should be used.

## Agent Identity

The agent identity comes from your normal Gemini CLI setup.

This extension does not ship a `GEMINI.md`, and it removes old binding-level `GEMINI.md`, `Gemini.md`, or `gemini.md` files. If you use a global Gemini context file, keep it in the normal global location, such as:

```text
~/.gemini/GEMINI.md
```

Discord is just the channel. Gemini CLI is still the agent.

## Usage

Use the configured Discord channel like a normal chat with your Gemini CLI agent.

Useful Discord commands:

- `/new` starts a fresh session
- `/status` shows daemon health
- `/ping` checks latency
- `/model` switches the active model
- `/pool` shows CLI pool state
- `/kill` stops a pooled Gemini process

Reminder examples:

- "Remind me in 30 minutes to post the release notes."
- "Tomorrow at 9am, remind me to check the overnight failures."

## Optional Settings

Most users only need the bot token, because the bridge can remember the rest in `.gemini-discord/config.json`. These optional environment variables can still be set for local development, explicit overrides, or advanced installs:

| Setting | Purpose |
| --- | --- |
| `DISCORD_CHANNEL_ID` | Optional explicit primary channel override. If blank, the first owner channel is remembered automatically. |
| `DISCORD_OWNER_IDS` | Optional explicit owner override. If blank, the daemon tries to infer the Discord application owner. |
| `DISCORD_ADMIN_ID` | Primary operator ID; defaults to the first owner |
| `DISCORD_ALLOWED_CHANNEL_IDS` | Extra channel allowlist; defaults to `DISCORD_CHANNEL_ID` |
| `DISCORD_ALLOWED_USER_IDS` | Extra allowed human users; defaults to owners |
| `DISCORD_ALLOWED_AGENT_IDS` | Allowed peer bot or agent IDs |
| `MEMORY_SCOPE` | `global` or `channel`; defaults to `global` |
| `GEMINI_SESSION_BINDING_SCOPE` | `global`, `server`, or `channel`; defaults to `global` |

For local development, start from [`.env.example`](./.env.example).

## Technical Notes

Runtime files are ignored by git and live under:

```text
.gemini-discord/
```

The main managed settings file is:

```text
.gemini-discord/config.json
```

That file is auto-created and updated by the project. It stores the effective config seen at runtime plus discovered Discord metadata such as the pinned server and primary channel.

Discord bindings store metadata such as session IDs, reset state, and temporary attachments. Gemini itself runs from the normal Gemini project context, so Discord bindings do not become isolated projects or separate agents.

MCP tools exposed to Gemini:

- `discord_status`
- `discord_send`
- `discord_reply`
- `discord_history`
- `discord_reset`
- `discord_restart`
- `discord_find_images`
- `discord_channels`
- `schedule_reminder`
- `schedule_cron_job`
- `list_cron_jobs`
- `delete_cron_job`

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Useful local commands:

```bash
npm run dev:daemon
npm run start:daemon
npm run start:server
npm run install-service
```

## Releasing

Before publishing:

1. Keep `gemini-extension.json` at the repository root.
2. Commit the built `dist/` files.
3. Keep `.env`, `.gemini-discord/`, logs, and local runtime files untracked.
4. Add the GitHub topic `gemini-cli-extension`.

GitHub installs should work directly from the repo URL.
