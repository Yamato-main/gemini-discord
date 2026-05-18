export const DISCORD_BRIDGE_TOOL_NAMES = [
  'discord_message',
  'discord_admin',
  'discord_history',
  'discord_cron',
  'discord_find_media',
] as const;

export const DISCORD_BRIDGE_TOOLS = DISCORD_BRIDGE_TOOL_NAMES.join(',');
