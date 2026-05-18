import type { Config } from '../shared/types.js';
import { daemonRequest } from './client.js';

export type PendingDeliveryKind = 'send' | 'reply' | 'reset' | 'schedule' | 'delete';

export interface PendingDelivery {
  id: string;
  kind: PendingDeliveryKind;
  path: string;
  body: Record<string, unknown>;
  firstFailureAt: string;
  lastFailureAt: string;
  lastError: string;
  attempts: number;
}

export interface PendingDeliveryRetryResult {
  attempted: number;
  delivered: PendingDelivery[];
  failed: PendingDelivery[];
}

export type DeliveryRequester = typeof daemonRequest;

const MAX_PENDING_DELIVERIES = 5;
const pendingDeliveries: PendingDelivery[] = [];

export function recordPendingDelivery(
  kind: PendingDeliveryKind,
  body: Record<string, unknown>,
  failureReason: string,
  path = pathForKind(kind),
): PendingDelivery {
  const normalized = normalizeDeliveryBody(body);
  const id = deliveryId(kind, path, normalized);
  const now = new Date().toISOString();
  const existing = pendingDeliveries.find((delivery) => delivery.id === id);

  if (existing) {
    existing.lastFailureAt = now;
    existing.lastError = failureReason;
    existing.attempts += 1;
    return existing;
  }

  const delivery: PendingDelivery = {
    id,
    kind,
    path,
    body: normalized,
    firstFailureAt: now,
    lastFailureAt: now,
    lastError: failureReason,
    attempts: 1,
  };

  pendingDeliveries.push(delivery);
  if (pendingDeliveries.length > MAX_PENDING_DELIVERIES) {
    pendingDeliveries.shift();
  }

  return delivery;
}

export function clearPendingDelivery(kind: PendingDeliveryKind, body: Record<string, unknown>): void {
  const id = deliveryId(kind, pathForKind(kind), normalizeDeliveryBody(body));
  clearPendingDeliveryById(id);
}

export function clearPendingAction(
  kind: PendingDeliveryKind,
  path: string,
  body: Record<string, unknown>,
): void {
  clearPendingDeliveryById(deliveryId(kind, path, normalizeDeliveryBody(body)));
}

function clearPendingDeliveryById(id: string): void {
  const index = pendingDeliveries.findIndex((delivery) => delivery.id === id);
  if (index !== -1) {
    pendingDeliveries.splice(index, 1);
  }
}

export function getPendingDeliveries(): readonly PendingDelivery[] {
  return pendingDeliveries;
}

export function hasPendingDeliveries(): boolean {
  return pendingDeliveries.length > 0;
}

export function clearPendingDeliveriesForTests(): void {
  pendingDeliveries.splice(0, pendingDeliveries.length);
}

export async function retryPendingDeliveries(
  config: Config,
  requester: DeliveryRequester = daemonRequest,
): Promise<PendingDeliveryRetryResult> {
  const deliveries = [...pendingDeliveries];
  const delivered: PendingDelivery[] = [];
  const failed: PendingDelivery[] = [];

  for (const delivery of deliveries) {
    const res = await requester({
      method: 'POST',
      path: delivery.path,
      config,
      body: delivery.body,
      timeoutMs: 60000,
    });

    if (res.ok) {
      clearPendingDelivery(delivery.kind, delivery.body);
      delivered.push(delivery);
      continue;
    }

    const error = formatDaemonError(res.data);
    recordPendingDelivery(delivery.kind, delivery.body, error);
    const latest = pendingDeliveries.find((pending) => pending.id === delivery.id);
    failed.push(latest ?? delivery);
  }

  return {
    attempted: deliveries.length,
    delivered,
    failed,
  };
}

export function formatPendingDeliveryRetryResult(result: PendingDeliveryRetryResult): string | null {
  if (result.attempted === 0) {
    return null;
  }

  if (result.failed.length === 0) {
    return `✅ Retried and delivered ${formatCount(result.delivered.length, 'pending Discord delivery', 'pending Discord deliveries')}.`;
  }

  const deliveredPart = result.delivered.length > 0
    ? ` Delivered ${formatCount(result.delivered.length, 'pending Discord delivery', 'pending Discord deliveries')}.`
    : '';
  const failedDetails = result.failed
    .map((delivery) => `${describeDelivery(delivery)} failed: ${delivery.lastError}`)
    .join('; ');

  return `⚠️${deliveredPart} ${formatCount(result.failed.length, 'Discord action remains', 'Discord actions remain')} pending: ${failedDetails}. Troubleshooting is not completion; retry again after the bridge, permission, or environment issue is fixed.`;
}

export function pendingDeliveryFailureText(action: 'Send' | 'Reply', error: string): string {
  return pendingActionFailureText(action, error);
}

export function pendingActionFailureText(action: string, error: string): string {
  return `❌ ${action} failed: ${error}\n\nThe original Discord action is still pending. Do not say it is complete. Troubleshooting is not completion; after fixing the bridge, permission, or environment issue, retry this same action before calling the task complete.`;
}

function normalizeDeliveryBody(body: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const key of ['channel_id', 'channel_name', 'message_id', 'content', 'files', 'guild_id', 'message', 'delay_minutes', 'deliver_at', 'cron_expression', 'run_once', 'job_id']) {
    const value = body[key];
    if (value == null) continue;
    if (key === 'files' && Array.isArray(value)) {
      normalized[key] = value.map(String);
    } else if (typeof value === 'string') {
      normalized[key] = value;
    } else {
      normalized[key] = String(value);
    }
  }

  return normalized;
}

function deliveryId(kind: PendingDeliveryKind, path: string, body: Record<string, unknown>): string {
  return `${kind}:${path}:${JSON.stringify(body)}`;
}

function formatDaemonError(data: Record<string, unknown>): string {
  const error = data['error'];
  return typeof error === 'string' && error.trim() ? error : 'unknown error';
}

function describeDelivery(delivery: PendingDelivery): string {
  const files = Array.isArray(delivery.body['files']) ? delivery.body['files'].length : 0;
  const target = delivery.body['channel_id'] ?? delivery.body['channel_name'] ?? 'current conversation';
  const filePart = files > 0 ? ` with ${formatCount(files, 'file', 'files')}` : '';
  return `${delivery.kind} action to ${target}${filePart}`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pathForKind(kind: PendingDeliveryKind): string {
  switch (kind) {
    case 'reply': return '/reply';
    case 'reset': return '/reset';
    case 'schedule': return '/cron';
    case 'delete': return '/cron/delete';
    case 'send':
    default:
      return '/send';
  }
}
