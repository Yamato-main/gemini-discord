import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'discord.js';
import { CronExpressionParser } from 'cron-parser';
import { log } from './log.js';
import type { Config } from '../shared/types.js';
import { chunkMessage } from '../shared/chunker.js';
import { sendDiscordMessage, type SendableChannel } from './sender.js';

export interface CronJob {
  id: string;
  cronExpression: string;
  message: string;
  channelId: string;
  authorId: string;
  nextRun: number;
  runOnce: boolean;
}

export interface ScheduleJobInput {
  cronExpression: string;
  message: string;
  channelId: string;
  authorId: string;
  runOnce?: boolean;
}

let jobs: Map<string, CronJob> = new Map();
let storePath: string = '';
let discordClient: Client | null = null;
let poller: NodeJS.Timeout | null = null;

export function initCron(config: Config, client: Client, extensionDir: string) {
  storePath = path.join(extensionDir, '.cron.json');
  discordClient = client;
  loadJobs();

  // 60-second polling loop
  poller = setInterval(checkJobs, 60_000);
  
  // Also do an immediate check on startup to catch any missed jobs
  setTimeout(checkJobs, 5000);
  
  log.info('Cron scheduler initialized', { jobs: jobs.size });
}

export function shutdownCron() {
  if (poller) clearInterval(poller);
}

function loadJobs() {
  jobs = new Map();
  try {
    if (fs.existsSync(storePath)) {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      if (Array.isArray(data)) {
        jobs = new Map(
          data
            .map(coerceCronJob)
            .filter((job): job is CronJob => job !== null)
            .map((job) => [job.id, job]),
        );
      }
    }
  } catch (err) {
    log.error('Failed to load cron jobs', { error: err });
  }
}

function saveJobs() {
  try {
    const data = Array.from(jobs.values());
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    log.error('Failed to save cron jobs', { error: err });
  }
}

export function scheduleJob(input: ScheduleJobInput): string {
  try {
    // Validate cron expression
    const interval = CronExpressionParser.parse(input.cronExpression);
    const id = Math.random().toString(36).substring(2, 10);
    const job: CronJob = {
      id,
      cronExpression: input.cronExpression,
      message: input.message,
      channelId: input.channelId,
      authorId: input.authorId,
      nextRun: interval.next().getTime(),
      runOnce: input.runOnce !== false,
    };
    
    jobs.set(id, job);
    saveJobs();
    log.info('Scheduled new cron job', {
      id,
      channelId: job.channelId,
      runOnce: job.runOnce,
      nextRun: new Date(job.nextRun).toISOString(),
    });
    return id;
  } catch (err) {
    throw new Error(`Invalid cron expression: ${err}`);
  }
}

export function listJobs(): CronJob[] {
  return Array.from(jobs.values());
}

export function deleteJob(id: string): boolean {
  const deleted = jobs.delete(id);
  if (deleted) saveJobs();
  return deleted;
}

async function checkJobs() {
  const now = Date.now();
  let updated = false;

  for (const job of [...jobs.values()]) {
    if (now >= job.nextRun) {
      log.info('Executing cron job', { id: job.id });

      let nextRun: number | null = null;
      if (!job.runOnce) {
        try {
          const interval = CronExpressionParser.parse(job.cronExpression);
          nextRun = interval.next().getTime();
        } catch (err) {
          log.error('Failed to parse cron for next run, deleting job', { id: job.id });
          jobs.delete(job.id);
          updated = true;
          continue;
        }
      }

      const delivered = await deliverCronJob(job);

      if (job.runOnce) {
        if (delivered) {
          jobs.delete(job.id);
        } else {
          job.nextRun = now + 60_000;
        }
        updated = true;
        continue;
      }

      if (nextRun !== null) {
        job.nextRun = nextRun;
        updated = true;
      }
    }
  }

  if (updated) {
    saveJobs();
  }
}

async function deliverCronJob(job: CronJob): Promise<boolean> {
  if (!discordClient) {
    log.warn('Cron delivery skipped: Discord client not ready', { id: job.id });
    return false;
  }

  try {
    const channel = await discordClient.channels.fetch(job.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      log.warn('Cron delivery target is not sendable', { id: job.id, channelId: job.channelId });
      return false;
    }

    await sendDiscordMessage(channel as SendableChannel, job.message, chunkMessage);
    return true;
  } catch (err) {
    log.error('Failed to deliver cron job', {
      id: job.id,
      channelId: job.channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function coerceCronJob(value: Record<string, unknown>): CronJob | null {
  const id = typeof value.id === 'string' ? value.id : '';
  const cronExpression = typeof value.cronExpression === 'string' ? value.cronExpression : '';
  const message = typeof value.message === 'string'
    ? value.message
    : typeof value.instruction === 'string'
      ? value.instruction
      : '';
  const channelId = typeof value.channelId === 'string' ? value.channelId : '';
  const authorId = typeof value.authorId === 'string' ? value.authorId : '';
  const nextRun = typeof value.nextRun === 'number' ? value.nextRun : 0;
  const runOnce = value.runOnce === undefined ? true : value.runOnce === true;

  if (!id || !cronExpression || !message || !channelId || !authorId || !nextRun) {
    return null;
  }

  return {
    id,
    cronExpression,
    message,
    channelId,
    authorId,
    nextRun,
    runOnce,
  };
}
