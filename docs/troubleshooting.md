# Troubleshooting

Use this page when `gemini-discord` does not come online after setup.

## Logs

Check `.gemini-discord/daemon.log` in the extension installation directory.

## Disallowed Intents (4014)

Discord closes the gateway with code `4014` when the bot requests privileged intents that are not enabled in the Discord Developer Portal.

Fix:
1. Open the Discord Developer Portal.
2. Select your application.
3. Go to **Bot**.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Enable **Server Members Intent** too, unless you set `DISCORD_ENABLE_SERVER_MEMBERS_INTENT=false`.

The daemon automatically falls back when Server Members Intent is unavailable, but Message Content Intent is still required for useful chat behavior.

## Invalid Token (4004)

Discord closes the gateway with code `4004` when the configured bot token is invalid or expired.

Fix:
1. Reset the bot token in the Discord Developer Portal.
2. Run `gemini extensions config gemini-discord`.
3. Enter the new token.
4. Restart Gemini CLI.
