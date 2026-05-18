import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../shared/types.js';
import { daemonRequest } from './client.js';
import {
  authorizeMcpToolAction,
  formatPermissionDenial,
  resolveMcpRoleContextFromEnv,
} from '../daemon/permissions.js';
import {
  clearPendingDelivery,
  pendingActionFailureText,
  recordPendingDelivery,
} from './pending-delivery.js';

export function registerCronTools(server: McpServer, config: Config) {
  server.tool(
    'discord_cron',
    'Manage scheduled messages and reminders. Actions: "schedule_reminder", "schedule_cron", "list", "delete".',
    {
      action: z.enum(['schedule_reminder', 'schedule_cron', 'list', 'delete']).describe('The cron action to perform.'),
      message: z.string().optional().describe('The exact final Discord message to send (required for schedule actions).'),
      cron_expression: z.string().optional().describe('The cron schedule expression, e.g. "0 9 * * *" (required for schedule_cron).'),
      delay_minutes: z.number().positive().optional().describe('Delay in minutes before reminder fires.'),
      delay_hours: z.number().positive().optional().describe('Additional delay in hours.'),
      delay_days: z.number().positive().optional().describe('Additional delay in days.'),
      deliver_at: z.string().optional().describe('Optional ISO-8601 timestamp for when to fire.'),
      channel_id: z.string().optional().describe('Explicit target Discord channel ID. Required for schedule actions unless channel_name is provided.'),
      channel_name: z.string().optional().describe('Explicit target Discord channel name. Required for schedule actions unless channel_id is provided.'),
      run_once: z.boolean().optional().describe('Whether this job should delete itself after first run. Defaults to true for reminders.'),
      job_id: z.string().optional().describe('The ID of the job to delete (required for delete).'),
    },
    async ({ action, message, cron_expression, delay_minutes, delay_hours, delay_days, deliver_at, channel_id, channel_name, run_once, job_id }) => {
      const gate = authorizeMcpToolAction('cron', config);
      if (gate.decision !== 'allow') {
        return { content: [{ type: 'text', text: formatPermissionDenial(gate) }], isError: true };
      }

      if (action === 'list') {
        const roleContext = resolveMcpRoleContextFromEnv(process.env, config);
        const resp = await fetch(`http://127.0.0.1:${config.daemonPort}/cron`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.daemonApiToken}`,
            ...(roleContext ? {
              'X-Gemini-Discord-Role': roleContext.role,
              'X-Gemini-Discord-Sender-Id': roleContext.senderDiscordId,
              'X-Gemini-Discord-Sender-Label': roleContext.senderDisplayLabel,
            } : {}),
          },
        });

        if (!resp.ok) {
          return { content: [{ type: 'text', text: 'Failed to fetch cron jobs' }], isError: true };
        }

        const data = await resp.json();
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        if (jobs.length === 0) {
          return { content: [{ type: 'text', text: 'No cron jobs are currently scheduled.' }] };
        }

        const lines = jobs.map((job: any) => {
          const nextRun = typeof job.nextRun === 'number' ? new Date(job.nextRun).toISOString() : 'unknown';
          const mode = job.runOnce === false ? 'recurring' : 'run-once';
          return `- ${job.id} | ${mode} | channel ${job.channelId} | next ${nextRun} | ${job.message}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      if (action === 'delete') {
        if (!job_id) return { content: [{ type: 'text', text: 'job_id is required' }], isError: true };
        const body = { job_id };
        const resp = await daemonRequest({ method: 'POST', path: '/cron/delete', config, body });

        if (!resp.ok) {
          const error = String(resp.data['error'] ?? 'unknown error');
          recordPendingDelivery('delete', body, error);
          return { content: [{ type: 'text', text: pendingActionFailureText('Delete cron job', error) }], isError: true };
        }

        clearPendingDelivery('delete', body);
        return { content: [{ type: 'text', text: resp.data.ok ? 'Job deleted successfully' : 'Job not found' }] };
      }

      if (action === 'schedule_reminder') {
        if (!message) return { content: [{ type: 'text', text: 'message is required' }], isError: true };
        if (!channel_id && !channel_name) return { content: [{ type: 'text', text: 'channel_id or channel_name is required' }], isError: true };
        const totalDelayMinutes = (delay_minutes ?? 0) + ((delay_hours ?? 0) * 60) + ((delay_days ?? 0) * 24 * 60);
        if (!deliver_at && totalDelayMinutes <= 0) {
          return { content: [{ type: 'text', text: 'Failed to schedule reminder: provide a future `deliver_at` or a positive delay.' }], isError: true };
        }

        const body = { message, delay_minutes: deliver_at ? undefined : totalDelayMinutes, deliver_at, channel_id, channel_name, run_once: true };
        const resp = await daemonRequest({ method: 'POST', path: '/cron', config, body });

        if (!resp.ok) {
          const error = String(resp.data['error'] ?? 'unknown error');
          recordPendingDelivery('schedule', body, error);
          return { content: [{ type: 'text', text: pendingActionFailureText('Schedule reminder', error) }], isError: true };
        }

        clearPendingDelivery('schedule', body);
        const deliveryLabel = deliver_at ? `for ${deliver_at}` : `in ${totalDelayMinutes} minute${totalDelayMinutes === 1 ? '' : 's'}`;
        return { content: [{ type: 'text', text: `Successfully scheduled reminder ${deliveryLabel}. Job ID: ${resp.data.job_id}` }] };
      }

      if (action === 'schedule_cron') {
        if (!message || !cron_expression) return { content: [{ type: 'text', text: 'message and cron_expression are required' }], isError: true };
        if (!channel_id && !channel_name) return { content: [{ type: 'text', text: 'channel_id or channel_name is required' }], isError: true };
        const body = { cron_expression, message, channel_id, channel_name, run_once };
        const resp = await daemonRequest({ method: 'POST', path: '/cron', config, body });

        if (!resp.ok) {
          const error = String(resp.data['error'] ?? 'unknown error');
          recordPendingDelivery('schedule', body, error);
          return { content: [{ type: 'text', text: pendingActionFailureText('Schedule job', error) }], isError: true };
        }

        clearPendingDelivery('schedule', body);
        return { content: [{ type: 'text', text: `Successfully scheduled job ID: ${resp.data.job_id}` }] };
      }

      return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
    }
  );
}
