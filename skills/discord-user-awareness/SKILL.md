---
name: discord-user-awareness
description: Resolve human Discord members and interpret @ pings correctly before allowlist, moderation, or targeting actions. Use when a user asks to allowlist someone, mentions "the other user", uses @mentions, or you need a stable user ID.
---

# Discord user awareness

## Boss vs guest allowlist (critical)

| Setting | Who | Powers |
|---------|-----|--------|
| `DISCORD_BOSS_USER_ID` | One human operator | Full bridge: user discovery, allowlist, admin, moderation |
| `DISCORD_ALLOWED_USER_IDS` | Other humans | **Chat only** when guests are disabled — no user lists, no admin tools |

Never put the **bot's** user ID in either field. Putting the bot on the guest allowlist does not give it admin powers — it only pollutes config.

## When to use

- The user wants to add or remove someone from the guest allowlist.
- The request refers to another person, "the other user", a display name, or a vague target.
- You need a stable numeric Discord user ID for `allowlist_add`, `kick`, or `timeout`.
- The message includes `@` pings and you must not confuse users, roles, channels, @everyone/@here, or this bot.

## @ mention rules

Every incoming Discord message includes a `[Mentions]` block. Trust it over guesswork:

| Signal | Meaning |
|--------|---------|
| **User pings** | Real `<@userId>` mentions — humans or bots, each with a stable id |
| **This bot** | Your bridge identity — never "the other user" |
| **Role pings** | `<@&roleId>` — not a user; do not allowlist or moderate as a person |
| **Channel refs** | `<#channelId>` — use channel discovery, not user discovery |
| **@everyone / @here** | Broadcast only — not a specific member |
| Plain `@Name` in text | **Not** a ping unless it appears under **User pings** |

When the user says "the other user" while pinging you, the target is a **different human** from the **User pings** list (or run `users` discovery).

## Workflow

1. Run `discord_admin` with action `status` if you do not already know the bot's own ID (shown as **Bot:** `name` (`id`)).
2. Run `discord_admin` with action `users`. Pass `query` when the user named someone or you need to narrow the list.
3. Pick a **human** from the **Humans** section. Never use an ID from **Bots** or the bot's own ID from status.
4. Run `allowlist_add` or moderation with the resolved `user_id`.

## Common mistakes

- Adding the bot's own ID to `DISCORD_ALLOWED_USER_IDS` when the user asked for another member.
- Editing `.env` manually without running user discovery first.
- Treating the boss/owner ID as "the other user" when they asked for a different server member.

## If discovery is empty

- Confirm **Server Members Intent** is enabled in the Discord Developer Portal.
- Ask the user for a mention, exact username, or numeric ID if discovery cannot resolve them.
