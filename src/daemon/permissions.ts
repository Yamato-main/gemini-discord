import type { Config } from '../shared/types.js';
import { DISCORD_BRIDGE_TOOLS } from '../shared/tool-names.js';
import type { ToolMode } from './tool-mode.js';

export type DiscordRole = 'BOSS' | 'GUEST';

export interface BossConfigValidation {
  valid: boolean;
  bossUserId: string;
  reason?: 'missing' | 'malformed';
}

export interface RoleContext {
  role: DiscordRole;
  senderDiscordId: string;
  senderDisplayLabel: string;
  bossLabel: 'the boss';
  bossConfigValid: boolean;
  bossConfigReason?: BossConfigValidation['reason'];
}

export type PermissionAction =
  | 'safe_chat'
  | 'public_web_search'
  | 'ambiguous_privileged_request'
  | 'prompt_bypass'
  | 'external_web'
  | 'gemini_tools'
  | 'shell'
  | 'local_file'
  | 'repo_inspection'
  | 'attachment_processing'
  | 'media_search'
  | 'session_reset'
  | 'admin_command'
  | 'moderation'
  | 'model_config'
  | 'outbound_discord'
  | 'cron'
  | 'history'
  | 'status'
  | 'user_discovery'
  | 'bot_introspection'
  | 'secrets';

export interface PermissionDecision {
  decision: 'allow' | 'deny' | 'needsBossApproval';
  action: PermissionAction;
  reason: string;
}

export interface RequestClassificationInput {
  content: string;
  attachmentCount?: number;
  toolMode?: ToolMode;
}

export const GUEST_PERMISSION_REFUSAL = 'I can only do that with approval from the authorized Discord user.';

const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;

const PROMPT_BYPASS_PATTERNS = [
  /\bignore (?:all )?(?:previous|prior|above) instructions\b/i,
  /\bignore (?:the |your |this |my |our )?(?:permission|permissions|policy|rules|auth|authorization)(?: system)?\b/i,
  /\b(?:the boss|yamato) (?:said|says|approved|approves|gave permission)\b/i,
  /\brole ?play as (?:the )?boss\b/i,
  /\bpretend (?:to be|i am|this is) (?:the )?boss\b/i,
  /\b(?:just|only) (?:a )?test\b/i,
  /\bsplit (?:it|this|the task) into smaller (?:steps|parts)\b/i,
  /\bpretend (?:this|that) is safe\b/i,
  /\bbypass (?:the )?(?:permission|permissions|policy|rules|auth|authorization)\b/i,
  /\bhow (?:do|can) i (?:bypass|override|disable) (?:the )?(?:permission|permissions|policy|auth|authorization)\b/i,
];

const SHELL_PATTERNS = [
  /\b(?:terminal|shell)\b/i,
  /\b(?:run|execute) (?:a |the |this )?(?:command|script)\b/i,
  /\b(?:run|execute|use) (?:npm|node|python|pip|git|curl|ssh|docker|kubectl)\b/i,
];

const LOCAL_FILE_PATTERNS = [
  /\b(?:read|open|show|inspect|edit|write|create|delete|move|rename|patch|modify) (?:a |the |this |that )?(?:local )?(?:file|folder|directory|config|log|env)\b/i,
  /\b(?:check|read|show|inspect) (?:the )?(?:logs?|configs?|env(?: vars|ironment)?|secrets?|tokens?|credentials?)\b/i,
  /\b(?:\.env|GEMINI\.md|AGENTS\.md)\b/i,
];

const PRIVILEGED_TOOL_NAME_PATTERNS = [
  /\b(?:use|call|invoke|run|execute|enable|allow|with) (?:the )?web_fetch\b/i,
  /\b(?:use|call|invoke|run|execute|enable|allow|with) (?:the )?(?:read|write|edit|list|glob|grep)_file(?:s)?\b/i,
  /\b(?:use|call|invoke|run|execute|enable|allow|with) (?:the )?(?:run_shell_command|shell_command)\b/i,
  /\b(?:use|call|invoke|run|execute|enable|allow|with) (?:the )?discord_(?:message|history|admin|cron|find_media)\b/i,
];

const REPO_PATTERNS = [
  /\b(?:inspect|read|look at|debug|analyze|search|grep|scan) (?:(?:the|my|this|that) )?(?:repo|repository|codebase|project)\b/i,
  /\b(?:work on|change|fix|implement in|refactor|patch) (?:(?:the|my|this|that) )?(?:repo|repository|codebase|project|code)\b/i,
];

const MEDIA_PATTERNS = [
  /\b(?:find|send|attach|fetch|get|grab|show|upload)\b.*\b(?:media|file|image|photo|picture|screenshot|video|movie|audio|song|music|clip|gif)\b/i,
  /\b(?:media|file|image|photo|picture|screenshot|video|movie|audio|song|music|clip|gif)\b.*\b(?:from|on) (?:my|the) (?:device|computer|mac|machine)\b/i,
  /\brandom (?:media|file|image|photo|picture|video|movie|audio|song|clip|gif)\b/i,
];

const OUTBOUND_DISCORD_PATTERNS = [
  /\b(?:send|post|reply|edit|delete|pin|unpin|react|unreact) (?:a |the |this |that )?(?:discord )?(?:message|reply|update)\b/i,
  /\b(?:send|post|reply) .*\b(?:to|in) #?[\w-]+\b/i,
  /\b(?:send|post|forward|share) .*\b(?:another|other|different) (?:discord )?channel\b/i,
  /\bcross-channel\b/i,
];

const CRON_PATTERNS = [
  /\b(?:remind|reminder|schedule|cron|monitor|report back|follow up|check back|send this later)\b/i,
];

const ADMIN_PATTERNS = [
  /\b(?:reset|clear|kill|restart) (?:the )?(?:session|conversation|daemon|bot|process|pool)\b/i,
  /\b(?:change|switch|set) (?:the )?(?:model|config|configuration|presence|status)\b/i,
  /\b(?:admin|owner|boss|permission|authorization|allowlist)\b/i,
];

const HISTORY_STATUS_PATTERNS = [
  /\b(?:history|transcript|previous messages|conversation buffer|what happened before|see what happened before)\b/i,
  /\b(?:status|health|pool|daemon|bot internals|introspect|debug the bot)\b/i,
];

const AMBIGUOUS_PRIVILEGED_PATTERNS = [
  /\b(?:latest|current|today'?s?|now|recent|newest|look this up|look up|check online|search the web|browse|research)\b/i,
  /\b(?:just run a quick command|check the logs|read the config|look at the repo|inspect this attachment)\b/i,
];

const NON_PUBLIC_WEB_PATTERNS = [
  /\b(?:authenticated|logged[- ]?in|sign(?:ed)? in|with (?:my|our) account|using (?:my|our) account|cookies?|session)\b/i,
  /\b(?:private|internal|gated|admin) (?:dashboard|site|portal|page|docs?|wiki|intranet)\b/i,
  /\b(?:download|upload|submit|post|fill (?:out )?form|send data|call (?:an? )?api|external api|api endpoint)\b/i,
];

export function validateBossConfig(configOrBossUserId: Config | string | undefined | null): BossConfigValidation {
  const raw = typeof configOrBossUserId === 'string'
    ? configOrBossUserId
    : configOrBossUserId?.discordBossUserId;
  const bossUserId = raw?.trim() ?? '';

  if (!bossUserId) {
    return { valid: false, bossUserId: '', reason: 'missing' };
  }

  if (!DISCORD_SNOWFLAKE_RE.test(bossUserId)) {
    return { valid: false, bossUserId, reason: 'malformed' };
  }

  return { valid: true, bossUserId };
}

export function resolveDiscordRole(
  config: Config,
  sender: { discordUserId: string; displayLabel?: string | null },
): RoleContext {
  const validation = validateBossConfig(config);
  const senderDiscordId = sender.discordUserId.trim();
  const role: DiscordRole = validation.valid && senderDiscordId === validation.bossUserId
    ? 'BOSS'
    : 'GUEST';

  return {
    role,
    senderDiscordId,
    senderDisplayLabel: sender.displayLabel?.trim() || senderDiscordId || 'unknown Discord user',
    bossLabel: 'the boss',
    bossConfigValid: validation.valid,
    bossConfigReason: validation.reason,
  };
}

export function isBoss(roleContext: RoleContext): boolean {
  return roleContext.role === 'BOSS';
}

export function isConfiguredBossDiscordId(config: Config, discordUserId: string): boolean {
  return resolveDiscordRole(config, { discordUserId }).role === 'BOSS';
}

export function authorizeAction(action: PermissionAction, roleContext: RoleContext): PermissionDecision {
  if (action === 'safe_chat' || action === 'public_web_search') {
    return { decision: 'allow', action, reason: action };
  }

  if (isBoss(roleContext)) {
    return { decision: 'allow', action, reason: 'boss' };
  }

  return {
    decision: 'deny',
    action,
    reason: roleContext.bossConfigValid ? 'guest_requires_boss' : `boss_config_${roleContext.bossConfigReason ?? 'invalid'}`,
  };
}

export function classifyRequestForGuest(input: RequestClassificationInput): PermissionAction {
  const content = input.content.trim();

  if ((input.attachmentCount ?? 0) > 0) return 'attachment_processing';
  if (!content) return 'safe_chat';
  if (PROMPT_BYPASS_PATTERNS.some((pattern) => pattern.test(content))) return 'prompt_bypass';
  if (PRIVILEGED_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(content))) return 'gemini_tools';

  if (SHELL_PATTERNS.some((pattern) => pattern.test(content))) return 'shell';
  if (LOCAL_FILE_PATTERNS.some((pattern) => pattern.test(content))) return 'local_file';
  if (REPO_PATTERNS.some((pattern) => pattern.test(content))) return 'repo_inspection';
  if (MEDIA_PATTERNS.some((pattern) => pattern.test(content))) return 'media_search';
  if (OUTBOUND_DISCORD_PATTERNS.some((pattern) => pattern.test(content))) return 'outbound_discord';
  if (CRON_PATTERNS.some((pattern) => pattern.test(content))) return 'cron';
  if (ADMIN_PATTERNS.some((pattern) => pattern.test(content))) return 'admin_command';
  if (HISTORY_STATUS_PATTERNS.some((pattern) => pattern.test(content))) return 'history';

  switch (input.toolMode) {
    case 'full':
      return 'gemini_tools';
    case 'discord':
    case 'web_discord':
      return 'outbound_discord';
    case 'web':
      return NON_PUBLIC_WEB_PATTERNS.some((pattern) => pattern.test(content))
        ? 'external_web'
        : 'public_web_search';
  }

  if (AMBIGUOUS_PRIVILEGED_PATTERNS.some((pattern) => pattern.test(content))) return 'ambiguous_privileged_request';

  return 'safe_chat';
}

export function authorizeGuestRequest(input: RequestClassificationInput, roleContext: RoleContext): PermissionDecision {
  if (isBoss(roleContext)) {
    return { decision: 'allow', action: 'safe_chat', reason: 'boss' };
  }

  return authorizeAction(classifyRequestForGuest(input), roleContext);
}

export function formatPermissionDenial(_decision: PermissionDecision): string {
  switch (_decision.action) {
    case 'outbound_discord':
      return 'I can answer here, but I cannot send, edit, or manage Discord messages for guests.';
    case 'attachment_processing':
    case 'media_search':
    case 'local_file':
      return 'I can chat here, but I cannot read, create, attach, or manage files for guests.';
    case 'shell':
    case 'repo_inspection':
    case 'gemini_tools':
      return 'I can help conceptually, but I cannot use tools, shell, repo, or local files for guests.';
    case 'history':
    case 'status':
    case 'bot_introspection':
    case 'user_discovery':
      return 'I cannot expose bridge internals, history, or server metadata to guests.';
    case 'cron':
      return 'I cannot schedule reminders or background Discord actions for guests.';
    case 'moderation':
    case 'admin_command':
    case 'session_reset':
    case 'model_config':
      return GUEST_PERMISSION_REFUSAL;
    default:
      return GUEST_PERMISSION_REFUSAL;
  }
}

export function roleEnv(roleContext: RoleContext): NodeJS.ProcessEnv {
  return {
    GEMINI_DISCORD_ROLE: roleContext.role,
    GEMINI_DISCORD_SENDER_ID: roleContext.senderDiscordId,
    GEMINI_DISCORD_SENDER_LABEL: roleContext.senderDisplayLabel,
  };
}

export function resolveGeminiAllowedTools(roleContext: RoleContext, toolMode: ToolMode): string {
  if (!isBoss(roleContext)) {
    return toolMode === 'web' ? 'google_web_search' : 'none';
  }

  switch (toolMode) {
    case 'chat':
      return 'none';
    case 'web':
      return 'google_web_search,web_fetch';
    case 'discord':
      return DISCORD_BRIDGE_TOOLS;
    case 'web_discord':
      return `google_web_search,web_fetch,${DISCORD_BRIDGE_TOOLS}`;
    case 'full':
      return 'all';
    default:
      return 'none';
  }
}

export function resolveMcpRoleContextFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  config?: Config,
): RoleContext | null {
  const role = env.GEMINI_DISCORD_ROLE;
  if (role !== 'BOSS' && role !== 'GUEST') {
    return null;
  }

  const senderDiscordId = env.GEMINI_DISCORD_SENDER_ID?.trim() || 'unknown';
  if (config) {
    return resolveDiscordRole(config, {
      discordUserId: senderDiscordId,
      displayLabel: env.GEMINI_DISCORD_SENDER_LABEL,
    });
  }

  return {
    role: 'GUEST',
    senderDiscordId,
    senderDisplayLabel: env.GEMINI_DISCORD_SENDER_LABEL?.trim() || senderDiscordId,
    bossLabel: 'the boss',
    bossConfigValid: false,
    bossConfigReason: 'missing',
  };
}

export function authorizeMcpToolAction(action: PermissionAction, config?: Config): PermissionDecision {
  const roleContext = resolveMcpRoleContextFromEnv(process.env, config);
  if (!roleContext) {
    return { decision: 'deny', action, reason: 'missing_discord_role_context' };
  }
  return authorizeAction(action, roleContext);
}
