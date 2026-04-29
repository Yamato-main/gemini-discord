import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../shared/types.js';

export function registerCronTools(server: McpServer, config: Config) {
  server.tool(
    'schedule_cron_job',
    {
      cron_expression: z.string().describe('The cron schedule expression (e.g. "0 9 * * *" for 9am daily).'),
      message: z.string().describe('The exact final Discord message to send when the job fires. Write the message itself, not instructions for another agent. Example: "Update: drink water."'),
      channel_id: z.string().optional().describe('Target Discord channel ID. Prefer this when you already know the exact ID.'),
      channel_name: z.string().optional().describe('Target Discord channel name such as "boardroom" or "#boardroom". Use this when you know the channel by name and want the daemon to resolve it.'),
      run_once: z.boolean().optional().describe('Whether this job should delete itself after the first successful send. Defaults to true for reminder-style jobs.'),
    },
    async ({ cron_expression, message, channel_id, channel_name, run_once }) => {
      const resp = await fetch(`http://127.0.0.1:${config.daemonPort}/cron`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.daemonApiToken}`,
        },
        body: JSON.stringify({
          cron_expression,
          message,
          channel_id,
          channel_name,
          run_once,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        return {
          content: [{ type: 'text', text: `Failed to schedule job: ${err.error}` }],
          isError: true,
        };
      }

      const data = await resp.json();
      return {
        content: [{ type: 'text', text: `Successfully scheduled job ID: ${data.job_id}` }],
      };
    }
  );

  server.tool(
    'list_cron_jobs',
    {},
    async () => {
      const resp = await fetch(`http://127.0.0.1:${config.daemonPort}/cron`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.daemonApiToken}`,
        },
      });

      if (!resp.ok) {
        return {
          content: [{ type: 'text', text: 'Failed to fetch cron jobs' }],
          isError: true,
        };
      }

      const data = await resp.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (jobs.length === 0) {
        return {
          content: [{ type: 'text', text: 'No cron jobs are currently scheduled.' }],
        };
      }

      const lines = jobs.map((job: any) => {
        const nextRun = typeof job.nextRun === 'number' ? new Date(job.nextRun).toISOString() : 'unknown';
        const mode = job.runOnce === false ? 'recurring' : 'run-once';
        return `- ${job.id} | ${mode} | channel ${job.channelId} | next ${nextRun} | ${job.message}`;
      });

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'delete_cron_job',
    {
      job_id: z.string().describe('The ID of the job to delete'),
    },
    async ({ job_id }) => {
      const resp = await fetch(`http://127.0.0.1:${config.daemonPort}/cron/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.daemonApiToken}`,
        },
        body: JSON.stringify({ job_id }),
      });

      if (!resp.ok) {
        return {
          content: [{ type: 'text', text: 'Failed to delete cron job' }],
          isError: true,
        };
      }

      const data = await resp.json();
      return {
        content: [{ type: 'text', text: data.ok ? 'Job deleted successfully' : 'Job not found' }],
      };
    }
  );
}
