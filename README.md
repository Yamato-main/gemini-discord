# gemini-discord

A secure, transport-agnostic Discord bridge for your local [Gemini CLI](https://github.com/google/gemini-cli) agent.

**This is not a hosted bot, a standalone application, or a separate Discord persona.** It is an extension that connects your existing local Gemini CLI agent to Discord, allowing you to interact with the same agent you use on your machine through a Discord interface.

### Why this exists
Local agents are powerful but often trapped in a single terminal session. This bridge lets you carry your agent's context, tools, and identity into Discord while maintaining strict local control and security.

### What it is not
- It is not a multi-tenant bot service.
- It is not a replacement for Gemini CLI.
- It is not a cloud-hosted solution.

---

## Installation

### 1. Create a Discord Bot
1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a New Application and name it.
3. Navigate to the **Bot** tab and add a bot.
4. **Token:** Reset and copy your bot token. This is your `DISCORD_BOT_TOKEN`.
5. **Privileged Gateway Intents:** Enable **Message Content Intent** (to read messages) and **Server Members Intent** (for user discovery).
6. **OAuth2 URL Generator:** 
   - Select the `bot` scope.
   - Grant permissions: `Read Messages/View Channels`, `Send Messages`, `Use Slash Commands`, `Attach Files`.
   - For moderation features: Grant `Kick Members` and `Moderate Members`. (Note: The bot's role must be higher than target users).
7. Invite the bot to your server using the generated URL.

### 2. Install the Extension
Install directly via Gemini CLI:

```bash
gemini extensions install https://github.com/Yamato-main/gemini-discord
```

The CLI will securely prompt you for:
- **Discord Bot Token**
- **Boss Discord User ID**: Your stable numeric Discord user ID (e.g., `853141321774006282`).
- **Discord Server ID**: The ID of the server where the bot was invited.

The bridge will start automatically the next time Gemini CLI loads it and send you a Discord DM once it is online.

---

## Identity & Architecture

The bridge inherits your **Gemini CLI persona and context** exactly. It does not ship with separate instructions or a `GEMINI.md` file to avoid identity drift. Your agent remains defined by your global config at `~/.gemini/GEMINI.md`.

Discord serves only as a **transport layer**. The bridge adds:
- A runtime header for Discord-compatible Markdown formatting.
- Rich context for replies, attachments, and server metadata.
- Secure routing for MCP tools and administration.

---

## Permissions & Security

This bridge operates on a strict **BOSS/GUEST** invariant.

### The Boss (`DISCORD_BOSS_USER_ID`)
Full bridge authority is granted **exclusively** to the user ID configured as the Boss.
- **Resolution:** Resolved only by stable numeric Discord user ID.
- **No Fallback:** Authority is *never* granted based on usernames, roles, server ownership, or admin status.
- **Capabilities:** Full access to all tools (shell, files, repo, MCP), administration, cron, and moderation.
- **Safety:** If the Boss ID is missing or malformed, the bridge fails closed for all privileged actions.

### Guests
Any user not explicitly configured as the Boss is treated as a Guest.
- **Capabilities:** Guests can chat and use public Google Search only.
- **Restrictions:** Guests **cannot** use MCP tools, shell, files, repo state, attachments, local media, outbound Discord actions, history, status, user discovery, cron, or admin features.

### Channel Safety
The bridge enforces a **no-fallback channel safety rule**:
- **Explicit Targets:** Sends, history reads, session resets, and scheduled messages require an explicit `channel_id` or `channel_name`.
- **No Defaults:** The bridge will never fall back to a "primary" or "default" channel if a target cannot be proven.
- **Isolation:** Memory and Gemini sessions are isolated by channel, thread, or DM user.

---

## Usage & Tools

Talk to the bot in DMs or allowed channels. It supports native Discord attachments (images, video, audio, PDF, text, source code). Large files are handled via local links, while small media is sent directly to the Gemini session.

### Core Commands
- `/new`: Start a fresh conversation session.
- `/status`: Check daemon health and system stats.
- `/ping`: Check bot and API latency.
- `/model`: Switch the active Gemini model.

### MCP Tools (Boss Only)
| Tool | Scope |
| --- | --- |
| `discord_message` | `send`, `reply`, `edit`, `delete`, `react`, `unreact`, `fetch_reactions`, `pin`, `unpin`, `list_pins` |
| `discord_history` | Read recent exchanges, conversation buffer, and archives. |
| `discord_admin` | `status`, `restart`, `reset`, `channels`, `users`, `set_presence`, `kick`, `timeout` |
| `discord_cron` | `schedule_reminder`, `schedule_cron`, `list`, `delete` |
| `discord_find_media` | Search and upload local media files from the host machine. |

---

## Development & Release

### Workflow
```bash
npm install        # Install dependencies
npm run typecheck  # Verify type safety
npm test           # Run full suite (160+ tests)
npm run build      # Generate dist/ output
```

### Before Release Checklist
1. Verify `gemini-extension.json` is at the repo root.
2. **Crucial:** Build and commit all `dist/` files.
3. Ensure `.env`, `.gemini-discord/`, and logs remain untracked.
4. Tag the repo with `gemini-cli-extension`.

---

## Permission Smoke Table

| Sender | Intent | Result |
| --- | --- | --- |
| GUEST | `Who is the CEO of OpenAI?` | **ALLOWED** (Public Search) |
| GUEST | `Search the repo for secrets` | **DENIED** (Files/Repo Tool) |
| GUEST | `Send this message to #general` | **DENIED** (Outbound Discord) |
| GUEST | `Summarize this attachment` | **DENIED** (Attachment Access) |
| GUEST | `Schedule a reminder` | **DENIED** (Cron) |
| BOSS | Full tool/system request | **ALLOWED** |
| Malformed Boss ID | Any privileged request | **DENIED** (Fails Closed) |

---

## License
MIT License. Copyright (c) 2026 Yamato-main.
