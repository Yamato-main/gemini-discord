/**
 * discord_status tool — Check daemon health and connection state.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config, DaemonStatus } from '../shared/types.js';
import { daemonRequest } from './client.js';

export function registerStatusTool(server: McpServer, config: Config): void {
  server.tool(
    'discord_status',
    'Check the Discord daemon health, connection state, and bot info. Call this first when troubleshooting.',
    {},
    async () => {
      const res = await daemonRequest({ method: 'GET', path: '/status', config });

      if (res.data['error'] === 'daemon_offline') {
        return text('❌ Daemon is offline. Start it: node dist/setup.cjs');
      }

      if (res.data['error'] === 'daemon_timeout') {
        return text('⏳ Daemon is not responding. It may be starting up. Try again in a few seconds.');
      }

      if (!res.ok) {
        return text(`❌ Daemon error: ${JSON.stringify(res.data)}`);
      }

      const s = res.data as unknown as DaemonStatus;

      const lines = [
        `**Status:** ${statusEmoji(s.status)} ${s.status}`,
        `**Bot:** ${s.botTag ?? 'not connected'}`,
        `**WebSocket Ping:** ${s.wsPing}ms`,
        `**Gemini:** ${s.geminiReachable ? '✅ reachable' : '❌ unreachable'} (${s.geminiVersion})`,
        `**Streaming:** ${s.streaming ? 'enabled' : 'disabled'}`,
        `**DMs:** ${s.enableDMs ? 'enabled' : 'disabled'}`,
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
        s.channels.forEach(c => {
          lines.push(`- **#${c.name}**: \`${c.id}\``);
        });
      }

      if (s.autonomous) {
        lines.push('', '### Autonomous');
        lines.push(`- **Enabled:** ${s.autonomous.enabled ? 'yes' : 'no'}`);
        lines.push(`- **Running:** ${s.autonomous.running ? 'yes' : 'no'}`);
        lines.push(`- **Interval:** ${s.autonomous.intervalMs}ms`);
        lines.push(`- **Target Channel:** ${s.autonomous.targetChannelName || s.autonomous.targetChannelId || '(default)'}`);
        for (const source of s.autonomous.sources) {
          lines.push(`- **${source.id}:** ${source.lastDecision ?? 'idle'} | signal ${source.lastSignalScore} | last post ${source.lastPostedAt ?? 'never'}`);
        }
      }

      if (s.cronJobs && s.cronJobs.length > 0) {
        lines.push('', '### Cron Jobs');
        for (const job of s.cronJobs) {
          lines.push(`- **${job.id}:** ${job.runOnce ? 'one-time' : 'recurring'} | next ${new Date(job.nextRun).toISOString()} | <#${job.channelId}> | ${job.message}`);
        }
      }

      if (s.watchJobs && s.watchJobs.length > 0) {
        lines.push('', '### Watch Jobs');
        for (const job of s.watchJobs) {
          lines.push(`- **${job.id}:** ${job.status} | ${job.topic} | /${job.board}/ | due ${job.dueAt} | signal ${job.lastSignalScore}`);
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
          lines.push(`- **${binding.workspace}:** ${binding.hasSession ? `session ${binding.lastSessionId ?? '(unknown id)'}` : 'no session yet'}`);
        }
      }

      if (s.lastError) {
        lines.push(`**Last Error:** ${s.lastError}`);
      }

      return text(lines.join('\n'));
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

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}
