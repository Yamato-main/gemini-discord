import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'discord.js';
import { CronExpressionParser } from 'cron-parser';
import { log } from './log.js';
import type { Config } from '../shared/types.js';
import { chunkMessage } from '../shared/chunker.js';
import { sendDiscordMessage, type SendableChannel } from './sender.js';
import { resolveRuntimePaths } from '../shared/runtime-paths.js';

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

export interface ScheduleReminderInput {
  message: string;
  channelId: string;
  authorId: string;
  delayMinutes?: number;
  runAt?: number;
}

const MIN_REMINDER_DELAY_MS = 60_000;

let jobs: Map<string, CronJob> = new Map();
let storePath: string = '';
let discordClient: Client | null = null;
let poller: NodeJS.Timeout | null = null;

export function initCron(config: Config, client: Client, extensionDir: string) {
  storePath = resolveRuntimePaths(extensionDir).cronFile;
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
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    log.error('Failed to save cron jobs', { error: err });
  }
}

export function scheduleJob(input: ScheduleJobInput): string {
  try {
    // Validate cron expression
    const interval = CronExpressionParser.parse(input.cronExpression);
    const id = createJobId();
    const job: CronJob = {
      id,
      cronExpression: input.cronExpression,
      message: input.message,
      channelId: input.channelId,
      authorId: input.authorId,
      nextRun: interval.next().getTime(),
      runOnce: input.runOnce !== false,
    };
    
    persistJob(job, 'Scheduled new cron job');
    return id;
  } catch (err) {
    throw new Error(`Invalid cron expression: ${err}`);
  }
}

export function scheduleReminder(input: ScheduleReminderInput): string {
  const runAt = normalizeReminderRunAt(input);
  const job: CronJob = {
    id: createJobId(),
    cronExpression: `once:${new Date(runAt).toISOString()}`,
    message: input.message,
    channelId: input.channelId,
    authorId: input.authorId,
    nextRun: runAt,
    runOnce: true,
  };

  persistJob(job, 'Scheduled reminder');
  return job.id;
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

function createJobId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function persistJob(job: CronJob, message: string): void {
  jobs.set(job.id, job);
  saveJobs();
  log.info(message, {
    id: job.id,
    channelId: job.channelId,
    runOnce: job.runOnce,
    nextRun: new Date(job.nextRun).toISOString(),
  });
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

function normalizeReminderRunAt(input: ScheduleReminderInput): number {
  const requestedAt = typeof input.runAt === 'number'
    ? input.runAt
    : Date.now() + Math.round((input.delayMinutes ?? 0) * 60_000);

  if (!Number.isFinite(requestedAt)) {
    throw new Error('Invalid reminder time.');
  }

  const roundedUp = Math.ceil(requestedAt / MIN_REMINDER_DELAY_MS) * MIN_REMINDER_DELAY_MS;
  if (roundedUp < Date.now() + MIN_REMINDER_DELAY_MS) {
    throw new Error('Reminders must be scheduled at least 1 minute in the future.');
  }

  return roundedUp;
}
