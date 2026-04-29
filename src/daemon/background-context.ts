import type { CronJobSnapshot } from '../shared/types.js';
import { listJobs } from './cron.js';

const MAX_CRON_LINES = 3;
const MESSAGE_PREVIEW_LIMIT = 72;

export interface BackgroundOperationsSnapshot {
  cronJobs: CronJobSnapshot[];
}

export interface BackgroundContextOptions {
  channelId?: string;
  channelName?: string;
}

export function collectBackgroundOperationsSnapshot(): BackgroundOperationsSnapshot {
  return {
    cronJobs: listJobs().map((job) => ({ ...job })),
  };
}

export function getBackgroundOperationsContext(options: BackgroundContextOptions = {}): string {
  return buildBackgroundOperationsContext(collectBackgroundOperationsSnapshot(), options);
}

export function buildBackgroundOperationsContext(
  snapshot: BackgroundOperationsSnapshot,
  options: BackgroundContextOptions = {},
): string {
  const lines = [
    '[Background Operations]',
    '- This block is live runtime state for scheduled Discord jobs. Treat it as more current than older session memory if they conflict.',
  ];

  const cronJobs = prioritizeCronJobs(snapshot.cronJobs, options.channelId);

  lines.push(`- Active cron jobs: ${snapshot.cronJobs.length}.`);
  if (cronJobs.length > 0) {
    for (const job of cronJobs.slice(0, MAX_CRON_LINES)) {
      lines.push(
        `- Cron \`${job.id}\` -> ${describeTarget(job.channelId, options)} | next ${formatTimestamp(job.nextRun)} | ${job.runOnce ? 'one-time' : 'recurring'} | "${truncate(job.message, MESSAGE_PREVIEW_LIMIT)}"`,
      );
    }
    const remaining = snapshot.cronJobs.length - Math.min(snapshot.cronJobs.length, MAX_CRON_LINES);
    if (remaining > 0) {
      lines.push(`- ${remaining} more cron job(s) are active beyond the summary above.`);
    }
  }

  lines.push('- If you need exact scheduled-job detail, use `discord_status` or `list_cron_jobs` when those tools are available in this turn.');
  return lines.join('\n');
}

function prioritizeCronJobs(jobs: CronJobSnapshot[], channelId?: string): CronJobSnapshot[] {
  return [...jobs].sort((left, right) => {
    const channelScore = Number(left.channelId !== channelId) - Number(right.channelId !== channelId);
    if (channelScore !== 0) {
      return channelScore;
    }
    return left.nextRun - right.nextRun;
  });
}

function describeTarget(channelId: string, options: BackgroundContextOptions): string {
  if (options.channelId && channelId === options.channelId) {
    return options.channelName ? `this channel (#${options.channelName})` : 'this channel';
  }
  return `<#${channelId}>`;
}

function formatTimestamp(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toISOString().replace('.000Z', 'Z');
}

function truncate(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
