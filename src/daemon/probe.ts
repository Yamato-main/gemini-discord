import { log } from './log.js';

export interface ProbeResult {
  ok: boolean;
  botId: string | null;
  botTag: string | null;
  hasMessageContent: boolean;
  hasGuildMembers: boolean;
  error: string | null;
}

export async function probeDiscordGateway(token: string): Promise<ProbeResult> {
  log.info('Probing Discord API for bot identity and intents...');
  
  try {
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` }
    });
    
    if (!userRes.ok) {
      if (userRes.status === 401) {
        return { ok: false, botId: null, botTag: null, hasMessageContent: false, hasGuildMembers: false, error: 'Invalid or missing bot token' };
      }
      return { ok: false, botId: null, botTag: null, hasMessageContent: false, hasGuildMembers: false, error: `Failed to fetch bot user: HTTP ${userRes.status}` };
    }
    
    const userBody = (await userRes.json()) as any;
    const botId = userBody.id;
    // Discord shifted away from discriminators for many users, but bots still often have them.
    const botTag = userBody.discriminator && userBody.discriminator !== '0'
      ? `${userBody.username}#${userBody.discriminator}`
      : userBody.username;
    
    const appRes = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` }
    });
    
    let hasMessageContent = false;
    let hasGuildMembers = false;
    if (appRes.ok) {
      const appBody = (await appRes.json()) as any;
      const flags = appBody.flags || 0;
      // Gateway Guild Members (1 << 14) and Gateway Guild Members Limited (1 << 15)
      // Gateway Message Content (1 << 18) and Gateway Message Content Limited (1 << 19)
      const GATEWAY_GUILD_MEMBERS = 1 << 14;
      const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
      const GATEWAY_MESSAGE_CONTENT = 1 << 18;
      const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
      hasMessageContent = ((flags & GATEWAY_MESSAGE_CONTENT) !== 0) || ((flags & GATEWAY_MESSAGE_CONTENT_LIMITED) !== 0);
      hasGuildMembers = ((flags & GATEWAY_GUILD_MEMBERS) !== 0) || ((flags & GATEWAY_GUILD_MEMBERS_LIMITED) !== 0);
    } else {
      log.warn('Failed to fetch bot application intents. Proceeding without explicit verification.');
      hasMessageContent = true; // Assume true if we can't fetch it, to avoid breaking legacy setups.
      hasGuildMembers = true;
    }
    
    return {
      ok: true,
      botId,
      botTag,
      hasMessageContent,
      hasGuildMembers,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, botId: null, botTag: null, hasMessageContent: false, hasGuildMembers: false, error: message };
  }
}
