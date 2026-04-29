# gemini-discord

`gemini-discord` binds a real local [Gemini CLI](https://geminicli.com) agent to Discord.

It is not a hosted bot and it is not a second persona layered on top of Gemini. The goal is simple: the same local agent you run in Gemini CLI should be able to speak in Discord with the same identity, session continuity, and tool awareness.

## What It Does

- Streams Discord replies from a local Gemini CLI-backed daemon
- Keeps Gemini CLI conversation sessions resumable without creating per-channel project contexts
- Passes only Discord transport awareness with each turn
- Supports `/new` as a real fresh-session reset with transcript archiving
- Exposes MCP tools for sending messages, reading history, restarting the daemon, scheduling reminders, and discovering channels

## Release-Ready Design

This repository is set up so you can publish it without leaking personal state:

- Runtime state lives under `.gemini-discord/`
- Local overrides live in `.env`
- Both are gitignored
- The extension does not ship its own `GEMINI.md`
- Binding folders never contain `GEMINI.md`, `Gemini.md`, or `gemini.md`
- Gemini identity comes from your normal global Gemini context, such as `~/.gemini/GEMINI.md`

The extension also centralizes install-time settings so the MCP server, daemon, detached restarts, and local development all read from the same configuration flow.

## How Sessions Work

Discord bindings are metadata folders under:

```text
.gemini-discord/bindings/<binding>
```

Those folders store session ids, reset metadata, and transient attachment files only. Gemini itself is launched from the normal Gemini project context, so bindings do not become isolated projects or isolated agents.

`/new` now does three things:

1. Archives the active Discord transcript mirror
2. Archives the current Gemini session reference for that binding
3. Forces the next turn onto a new Gemini CLI session

Older chats are still available through `discord_history` when the user explicitly asks for archived context.

## Speed Model

The fast path is intentionally protected:

- replies stream immediately
- first visible output is emitted earlier
- Gemini CLI sessions stay warm in the pool
- normal chat avoids unnecessary tool exposure
- prompt replay is capped so long-lived channels do not get slower over time

Scheduled reminders are kept separate so they do not drag down live Discord response time.

## Install

Prerequisites:

- Node.js 22+
- Gemini CLI installed and authenticated
- a Discord bot token
- Discord Message Content intent enabled for the bot

Install from a local path while developing:

```bash
gemini extensions install /absolute/path/to/gemini-discord
```

Install from GitHub after publishing:

```bash
gemini extensions install https://github.com/<owner>/gemini-discord
```

During install, Gemini CLI prompts for the extension settings declared in [`gemini-extension.json`](./gemini-extension.json). Those values are then persisted for the extension and mirrored into the extension runtime so the daemon can keep working after detached restarts.

If you change settings later:

```bash
gemini extensions config gemini-discord
```

After installation, open or restart a Gemini CLI session once so the MCP server can auto-start the daemon. From there the Discord bot should come online automatically.

## Important Settings

These are the main settings most users care about:

| Setting | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_CHANNEL_ID` | Default channel for normal traffic |
| `DISCORD_OWNER_IDS` | Full owners of the bridge |
| `DISCORD_ADMIN_ID` | Primary operator ID |
| `DISCORD_ALLOWED_CHANNEL_IDS` | Channel allowlist |
| `DISCORD_ALLOWED_USER_IDS` | Extra allowed human users |
| `DISCORD_ALLOWED_AGENT_IDS` | Allowed peer agents or bots |
| `MEMORY_SCOPE` | `global` or `channel`; defaults to `global` |
| `GEMINI_SESSION_BINDING_SCOPE` | `global`, `server`, or `channel`; defaults to `global` |

For local development, start from [`.env.example`](./.env.example).

## Runtime Layout

```text
.gemini-discord/
  bindings/
  config.json
  daemon-token
  daemon.log
  memory.json
  cron.json
  dm-pairings.json
```

That single runtime directory is the main boundary between publishable source and local machine state.

## MCP Tools

- `discord_status`
- `discord_send`
- `discord_reply`
- `discord_history`
- `discord_reset`
- `discord_restart`
- `discord_find_images`
- `discord_channels`
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

For local iteration with Gemini CLI:

```bash
gemini extensions link .
```

Useful commands:

```bash
npm run dev:daemon
npm run start:daemon
npm run start:server
npm run install-service
```

## Releasing

The simplest distribution model is a public GitHub repository. Gemini CLI supports installing directly from a repo URL, and the official docs recommend that path for flexibility with branches and updates.

Before publishing:

1. Keep `gemini-extension.json` at the repository root
2. Commit built `dist/` artifacts
3. Make sure `.env` and `.gemini-discord/` stay untracked
4. Add the GitHub topic `gemini-cli-extension`

If you later want faster first-time installs, you can also ship GitHub Releases with prebuilt archives.
