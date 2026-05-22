import * as http from 'node:http';
import { scheduleJob, scheduleReminder, deleteJob } from '../cron.js';
import { resolveDiscoveredChannel } from '../channels.js';
import {
  respond,
  authorizeApiAction,
  parseOptionalNumber,
  parseOptionalTimestamp,
  type ApiDependencies,
} from '../api-utils.js';

export async function handleCronRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  parsed: Record<string, unknown>,
  deps: ApiDependencies,
): Promise<boolean> {
  const { config } = deps;

  if (pathname === '/cron') {
    if (!authorizeApiAction(req, res, config, 'cron')) return true;
    const cronExpression = String(parsed['cron_expression'] ?? '');
    const legacyInstruction = String(parsed['instruction'] ?? '');
    const message = String(parsed['message'] ?? legacyInstruction);
    const requestedChannelId = parsed['channel_id'] == null ? '' : String(parsed['channel_id']);
    const requestedChannelName = parsed['channel_name'] == null ? '' : String(parsed['channel_name']);
    const authorId = String(parsed['author_id'] ?? config.discordBossUserId);
    const runOnce = parsed['run_once'] === undefined ? true : parsed['run_once'] === true;
    const delayMinutes = parseOptionalNumber(parsed['delay_minutes']);
    const deliverAt = parseOptionalTimestamp(parsed['deliver_at']);

    if (!message || (!cronExpression && delayMinutes === null && deliverAt === null)) {
      respond(res, 400, { error: 'message plus cron_expression, delay_minutes, or deliver_at is required' });
      return true;
    }

    try {
      let channelId = requestedChannelId;
      if (!requestedChannelId && requestedChannelName && deps.client) {
        const resolved = await resolveDiscoveredChannel(requestedChannelName, deps.client, config);
        if (!resolved) {
          respond(res, 400, { error: `Unknown channel: ${requestedChannelName}` });
          return true;
        }
        channelId = resolved.id;
      }

      if (!channelId) {
        respond(res, 400, {
          error: 'No proven Discord target is available. Provide channel_id or channel_name explicitly.',
        });
        return true;
      }

      const jobId = cronExpression
        ? scheduleJob({
          cronExpression,
          message,
          channelId,
          authorId,
          runOnce,
        })
        : scheduleReminder({
          message,
          channelId,
          authorId,
          delayMinutes: delayMinutes ?? undefined,
          runAt: deliverAt ?? undefined,
        });
      respond(res, 200, { ok: true, job_id: jobId });
    } catch (err) {
      respond(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/cron/delete') {
    if (!authorizeApiAction(req, res, config, 'cron')) return true;
    const jobId = String(parsed['job_id'] ?? '');
    if (!jobId) {
      respond(res, 400, { error: 'job_id is required' });
      return true;
    }
    const ok = deleteJob(jobId);
    respond(res, 200, { ok });
    return true;
  }

  return false;
}
