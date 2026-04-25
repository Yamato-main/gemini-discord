import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config, WatchJobStatus } from '../shared/types.js';
import { daemonRequest } from './client.js';

export function registerWatchTools(server: McpServer, config: Config): void {
  server.tool(
    'schedule_watch_job',
    {
      source: z.enum(['4chan_a_watch']).optional().describe('Background watch source. Currently only 4chan /a/ watch is supported.'),
      topic: z.string().describe('What Yamato wants monitored. Example: "One Piece spoiler thread".'),
      board: z.string().optional().describe('4chan board to monitor. Defaults to "a".'),
      keywords: z.array(z.string()).min(1).describe('Keywords the background collector should use to find relevant threads.'),
      report_in_minutes: z.number().optional().describe('How long to collect before waking Gemini to report back. Defaults to 30.'),
      poll_every_minutes: z.number().optional().describe('How often the collector should poll for changes while waiting. Defaults to 5.'),
      channel_id: z.string().optional().describe('Optional target Discord channel ID for the final report.'),
      channel_name: z.string().optional().describe('Optional target Discord channel name such as "boardroom" or "#boardroom".'),
      min_signal: z.number().optional().describe('Minimum signal target used for status/scoring while collecting. Defaults to 3.'),
    },
    async ({ source = '4chan_a_watch', topic, board, keywords, report_in_minutes, poll_every_minutes, channel_id, channel_name, min_signal }) => {
      const res = await daemonRequest({
        method: 'POST',
        path: '/watch',
        config,
        body: {
          source,
          topic,
          board,
          keywords,
          report_in_minutes,
          poll_every_minutes,
          channel_id,
          channel_name,
          min_signal,
        },
      });

      if (!res.ok) {
        return text(`❌ Failed to schedule watch job: ${res.data['error'] ?? 'unknown error'}`, true);
      }

      const job = (res.data['job'] ?? {}) as Partial<WatchJobStatus>;
      const dueAt = typeof job.dueAt === 'string' ? job.dueAt : 'unknown time';
      const pollEveryMs = typeof job.pollEveryMs === 'number' ? job.pollEveryMs : 0;
      const pollEveryMinutes = pollEveryMs > 0 ? Math.round(pollEveryMs / 60000) : 0;
      const target = job.channelName || job.channelId || channel_name || channel_id || config.discordChannelId;

      return text(
        `Watcher armed: ${job.id ?? '(unknown id)'} | topic: ${job.topic ?? topic} | source: /${job.board ?? (board ?? 'a')}/ | collector every ${pollEveryMinutes || 5}m | Gemini wake-up near ${dueAt} | target ${target}.`,
      );
    },
  );

  server.tool(
    'list_watch_jobs',
    {},
    async () => {
      const res = await daemonRequest({ method: 'GET', path: '/watch', config });
      if (!res.ok) {
        return text(`❌ Failed to fetch watch jobs: ${res.data['error'] ?? 'unknown error'}`, true);
      }

      const jobs = Array.isArray(res.data['jobs']) ? res.data['jobs'] as WatchJobStatus[] : [];
      if (jobs.length === 0) {
        return text('No background watch jobs are currently scheduled.');
      }

      const lines = jobs.map((job) => (
        `- ${job.id} | ${job.status} | ${job.topic} | /${job.board}/ | due ${job.dueAt} | target ${job.channelName || job.channelId}`
      ));
      return text(lines.join('\n'));
    },
  );

  server.tool(
    'delete_watch_job',
    {
      job_id: z.string().describe('The watch job ID to delete.'),
    },
    async ({ job_id }) => {
      const res = await daemonRequest({
        method: 'POST',
        path: '/watch/delete',
        config,
        body: { job_id },
      });

      if (!res.ok) {
        return text(`❌ Failed to delete watch job: ${res.data['error'] ?? 'unknown error'}`, true);
      }

      return text(Boolean(res.data['ok']) ? 'Watch job deleted successfully.' : 'Watch job not found.');
    },
  );
}

function text(content: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text: content }],
    ...(isError ? { isError: true } : {}),
  };
}
