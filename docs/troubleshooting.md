# Troubleshooting

Use this page when `gemini-discord` does not come online after setup.

## Logs

Check `.gemini-discord/daemon.log` in the extension installation directory.

## Port Conflicts

The daemon treats `DAEMON_PORT` as a preferred port, not a hard requirement. If the configured port is already occupied, it tries subsequent ports and records the active port in `.gemini-discord/daemon.port` so MCP tools can reconnect automatically.

Fix:
1. Read `.gemini-discord/daemon.log` and look for `Port <number> in use, trying next...` followed by `Control API listening`.
2. Check `.gemini-discord/daemon.port` to confirm the active control API port.
3. If MCP tools still report the daemon as offline, restart Gemini CLI so the extension process reloads runtime state.
4. Only change `DAEMON_PORT` manually if you need a stable preferred port; do not edit `gemini-extension.json` for routine conflicts.

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
