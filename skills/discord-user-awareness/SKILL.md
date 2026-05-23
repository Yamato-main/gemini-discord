---
name: discord-user-awareness
description: Resolve human Discord members before allowlist or moderation actions. Use when a user asks to allowlist someone, mentions "the other user", or you need a stable user ID.
---

# Discord user awareness

## When to use

- The user wants to add or remove someone from the guest allowlist.
- The request refers to another person, "the other user", a display name, or a vague target.
- You need a stable numeric Discord user ID for `allowlist_add`, `kick`, or `timeout`.

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
