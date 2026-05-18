import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config, DaemonStatus } from '../shared/types.js';
import { daemonRequest } from './client.js';
import { restartDaemon } from '../shared/daemon-runtime.js';
import { resolveExtensionDir } from '../shared/config.js';
import { authorizeMcpToolAction, formatPermissionDenial } from '../daemon/permissions.js';
import {
  clearPendingDelivery,
  pendingActionFailureText,
  recordPendingDelivery,
  formatPendingDeliveryRetryResult,
  hasPendingDeliveries,
  retryPendingDeliveries,
} from './pending-delivery.js';

export function registerAdminTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_admin',
    [
      'Administrative actions for the Discord bridge. Actions:',
      '• "status" — check health, config, and connected channels',
      '• "restart" — restart the daemon process',
      '• "reset" — clear the current conversation and archive the session',
      '• "channels" — list discovered channels (optional query filter)',
      '• "users" — list discovered server users or resolve a user lookup hint',
      '• "set_presence" — change the bot\'s online status and activity',
      '• "kick" — remove a member from the server',
      '• "timeout" — apply a communication timeout (up to 28 days)',
      '• "remove_timeout" — remove an active timeout from a member',
    ].join('\n'),
    {
      action: z.enum(['status', 'restart', 'reset', 'channels', 'users', 'set_presence', 'kick', 'timeout', 'remove_timeout']).describe('The administrative action to perform.'),
      query: z.string().optional().describe('Optional channel/user name, mention, ID, or partial string to filter discovery actions.'),
      channel_id: z.string().optional().describe('Explicit Discord channel ID for reset actions.'),
      status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional().describe('Bot online status (only for set_presence).'),
      activity_type: z.enum(['playing', 'watching', 'listening', 'competing']).optional().describe('Activity type (only for set_presence).'),
      activity_name: z.string().optional().describe('Activity name, e.g. "with fire" (only for set_presence).'),
      user_id: z.string().optional().describe('Stable numeric Discord user ID of the member to moderate (required for kick/timeout/remove_timeout). Use users discovery to resolve names or mentions first.'),
      guild_id: z.string().optional().describe('Discord server/guild ID. Defaults to the configured server (only for kick/timeout/remove_timeout).'),
      reason: z.string().optional().describe('Optional audit-log reason (only for kick/timeout/remove_timeout).'),
      duration_minutes: z.number().optional().describe('Timeout duration in minutes. Required for timeout. Maximum 40320 (28 days).'),
    },
    async ({ action, query, channel_id, status, activity_type, activity_name, user_id, guild_id, reason, duration_minutes }) => {
      const permAction = action === 'status' ? 'status' as const
        : action === 'users' ? 'user_discovery' as const
        : ['kick', 'timeout', 'remove_timeout'].includes(action) ? 'moderation' as const
        : 'admin_command' as const;
      const gate = authorizeMcpToolAction(permAction, config);
      if (gate.decision !== 'allow') {
        return text(formatPermissionDenial(gate), true);
      }

      if (action === 'status') {
        const res = await daemonRequest({ method: 'GET', path: '/status', config });

        if (res.data['error'] === 'daemon_offline') {
          return text('❌ Daemon is offline. Reopen Gemini CLI or run `npm run setup` in the extension directory if setup is incomplete.', hasPendingDeliveries());
        }

        if (res.data['error'] === 'daemon_timeout') {
          return text('⏳ Daemon is not responding. It may be starting up. Try again in a few seconds.', hasPendingDeliveries());
        }

        if (!res.ok) {
          return text(`❌ Daemon error: ${JSON.stringify(res.data)}.`, hasPendingDeliveries());
        }

        const s = res.data as unknown as DaemonStatus;
        const lines = [
          `**Status:** ${statusEmoji(s.status)} ${s.status}`,
          `**Bot:** ${s.botTag ?? 'not connected'}`,
          `**WebSocket Ping:** ${s.wsPing}ms`,
          `**Gemini:** ${s.geminiReachable ? '✅ reachable' : '❌ unreachable'} (${s.geminiVersion})`,
          `**Streaming:** ${s.streaming ? 'enabled' : 'disabled'}`,
          `**DMs:** ${s.enableDMs ? 'enabled' : 'disabled'}`,
          `**Server:** ${s.serverName ?? s.serverId ?? 'not yet pinned'}`,
          `**Primary Channel:** ${s.channelId || 'not yet pinned'}`,
          `**Memory Scope:** ${s.sessionScope}`,
          `**Gemini Session Binding Scope:** ${s.geminiSessionBindingScope}`,
          `**Gemini Headless Mode:** ${s.headlessMode ?? 'unknown'}`,
          `**Require Mention:** ${s.requireMention ? 'yes' : 'no'}`,
          `**Allowlisted Humans:** ${s.allowlistedUsers}`,
          `**Allowlisted Agents:** ${s.allowlistedAgents}`,
          `**Messages Handled:** ${s.messagesHandled}`,
          `**Last Message:** ${s.lastMessageAt ?? 'none'}`,
          `**Queue Depth:** ${s.queueDepth}`,
          `**Uptime Since:** ${s.startedAt}`,
        ];

        if (s.channels && s.channels.length > 0) {
          lines.push('', '### Discovered Channels');
          s.channels.forEach(c => lines.push(`- **#${c.name}**: \`${c.id}\``));
        }

        if (s.cronJobs && s.cronJobs.length > 0) {
          lines.push('', '### Cron Jobs');
          for (const job of s.cronJobs) {
            lines.push(`- **${job.id}:** ${job.runOnce ? 'one-time' : 'recurring'} | next ${new Date(job.nextRun).toISOString()} | <#${job.channelId}> | ${job.message}`);
          }
        }

        if (s.dmPairings && s.dmPairings.length > 0) {
          lines.push('', '### DM Pairings');
          for (const pairing of s.dmPairings) {
            lines.push(`- **${pairing.userId}:** channel ${pairing.channelId} | last seen ${pairing.lastSeenAt}`);
          }
        }

        if (s.bindings && s.bindings.length > 0) {
          lines.push('', '### Gemini Bindings');
          for (const binding of s.bindings) {
            const sessionSummary = binding.hasSession ? `session ${binding.lastSessionId ?? '(unknown id)'}` : 'no active session';
            lines.push(`- **${binding.workspace}:** ${sessionSummary} | archived ${binding.archivedSessions} | last reset ${binding.lastResetAt ?? 'never'}`);
          }
        }

        if (s.lastError) lines.push(`**Last Error:** ${s.lastError}`);

        if (hasPendingDeliveries()) {
          const retryResult = await retryPendingDeliveries(config);
          const retryMessage = formatPendingDeliveryRetryResult(retryResult);
          if (retryMessage) {
            lines.push('', '### Pending Delivery Retry', retryMessage);
            return text(lines.join('\n'), retryResult.failed.length > 0);
          }
        }

        return text(lines.join('\n'));
      }

      if (action === 'restart') {
        try {
          let tmpDir = process.cwd();
          try { tmpDir = __dirname; } catch {}
          const extensionDir = resolveExtensionDir(tmpDir);
          await restartDaemon(config, extensionDir);
          if (hasPendingDeliveries()) {
            const retryResult = await retryPendingDeliveries(config);
            const retryMessage = formatPendingDeliveryRetryResult(retryResult);
            return {
              isError: retryResult.failed.length > 0,
              content: [{ type: 'text', text: `✅ Discord daemon restarted successfully.${retryMessage ? `\n\n${retryMessage}` : ''}` }],
            };
          }
          return text('✅ Discord daemon restarted successfully.');
        } catch (err) {
          return text(`❌ Failed to restart Discord daemon: ${err instanceof Error ? err.message : String(err)}`, true);
        }
      }

      if (action === 'reset') {
        if (!channel_id) {
          return text('❌ Error: channel_id is required for reset.', true);
        }
        const body: Record<string, unknown> = { channel_id };
        if (guild_id) body['guild_id'] = guild_id;
        const res = await daemonRequest({ method: 'POST', path: '/reset', config, body });

        if (!res.ok) {
          const error = String(res.data['error'] ?? 'unknown error');
          recordPendingDelivery('reset', body, error);
          return text(pendingActionFailureText('Reset', error), true);
        }

        clearPendingDelivery('reset', body);
        return text('✅ Started a fresh conversation. The active Discord transcript was archived and the bound Gemini CLI session was restarted for the current channel.');
      }

      if (action === 'channels') {
        const res = await daemonRequest({ method: 'GET', path: '/status', config });

        if (res.data['error'] === 'daemon_offline') {
          return text('❌ Daemon is offline. Reopen Gemini CLI or run `npm run setup` in the extension directory if setup is incomplete.');
        }

        if (!res.ok) {
          return text(`❌ Failed to fetch channels: ${JSON.stringify(res.data)}`);
        }

        const status = res.data as unknown as DaemonStatus;
        const channels = status.channels ?? [];
        const needle = query?.trim().toLowerCase();
        const filtered = needle ? channels.filter((c) => c.name.toLowerCase().includes(needle) || c.id.includes(needle)) : channels;

        if (filtered.length === 0) {
          return text(needle ? `No discovered channels matched "${query}".` : 'No channels have been discovered yet.');
        }

        const lines = filtered.map((c) => `- #${c.name} → ${c.id}`);
        return text(lines.join('\n'));
      }

      if (action === 'users') {
        const params = new URLSearchParams();
        if (query?.trim()) params.set('query', query.trim());
        const res = await daemonRequest({
          method: 'GET',
          path: params.size > 0 ? `/users?${params.toString()}` : '/users',
          config,
        });

        if (!res.ok) {
          return text(`❌ Failed to fetch users: ${res.data['error'] ?? 'unknown error'}`, true);
        }

        const users = (res.data['users'] ?? []) as Array<{
          id: string;
          username: string;
          displayName?: string;
          globalName?: string;
          tag?: string;
          bot?: boolean;
        }>;
        const resolved = res.data['resolved'] as { id?: string } | null | undefined;
        if (users.length === 0) {
          return text(query ? `No discovered users matched "${query}".` : 'No users have been discovered yet.');
        }

        const lines: string[] = [];
        if (resolved?.id) {
          lines.push(`Resolved stable user ID: \`${resolved.id}\``, '');
        }
        for (const user of users) {
          const label = user.displayName || user.globalName || user.username;
          const bot = user.bot ? ' bot' : '';
          lines.push(`- **${label}**${bot}: \`${user.id}\`${user.tag ? ` (${user.tag})` : ''}`);
        }
        return text(lines.join('\n'));
      }

      if (action === 'set_presence') {
        const body: Record<string, unknown> = {};
        if (status) body['status'] = status;
        if (activity_type) body['activity_type'] = activity_type;
        if (activity_name) body['activity_name'] = activity_name;

        const res = await daemonRequest({
          method: 'POST',
          path: '/presence',
          config,
          body,
        });

        if (!res.ok) {
          return text(`❌ Failed to set presence: ${res.data['error'] ?? 'unknown error'}`, true);
        }

        const parts: string[] = [];
        if (status) parts.push(`Status: ${status}`);
        if (activity_name) parts.push(`Activity: ${activity_type ?? 'playing'} ${activity_name}`);
        return text(`✅ Presence updated. ${parts.join(' | ')}`);
      }

      // --- Moderation: kick, timeout, remove_timeout ---
      if (action === 'kick' || action === 'timeout' || action === 'remove_timeout') {
        if (!user_id?.trim()) {
          return text('❌ Error: user_id is required for moderation actions.', true);
        }

        if (action === 'timeout' && (duration_minutes === undefined || duration_minutes <= 0)) {
          return text('❌ Error: duration_minutes must be greater than 0 for timeout.', true);
        }

        const body: Record<string, unknown> = { action, user_id };
        if (guild_id) body['guild_id'] = guild_id;
        if (reason) body['reason'] = reason;
        if (duration_minutes !== undefined) body['duration_minutes'] = duration_minutes;

        const res = await daemonRequest({
          method: 'POST',
          path: '/moderation',
          config,
          body,
          timeoutMs: 60000,
        });

        if (!res.ok) {
          return text(`❌ Moderation failed: ${res.data['error'] ?? 'unknown error'}`, true);
        }

        const target = String(res.data['user_id'] ?? user_id);
        if (action === 'kick') return text(`✅ Kicked user ${target}.`);
        if (action === 'timeout') return text(`✅ Timed out user ${target} for ${duration_minutes} minute${duration_minutes === 1 ? '' : 's'}.`);
        return text(`✅ Removed timeout for user ${target}.`);
      }

      return text(`❌ Error: Unknown action ${action}`, true);
    },
  );
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'ready': return '🟢';
    case 'degraded': return '🟡';
    case 'starting': return '⏳';
    default: return '⚪';
  }
}

function text(content: string, isError = false) {
  return { isError, content: [{ type: 'text' as const, text: content }] };
}
