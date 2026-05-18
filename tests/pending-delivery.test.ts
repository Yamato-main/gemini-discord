import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingDeliveriesForTests,
  formatPendingDeliveryRetryResult,
  getPendingDeliveries,
  pendingDeliveryFailureText,
  recordPendingDelivery,
  retryPendingDeliveries,
  type DeliveryRequester,
} from '../src/tools/pending-delivery.js';
import { createConfig } from './test-utils/factories.js';

beforeEach(() => {
  clearPendingDeliveriesForTests();
});

describe('pending Discord deliveries', () => {
  it('retries and clears a failed send after the bridge is healthy', async () => {
    recordPendingDelivery('send', { content: '', files: ['/tmp/image.png'] }, 'daemon_offline');

    const requester = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { ok: true, messageIds: ['m1'] },
    })) satisfies DeliveryRequester;

    const result = await retryPendingDeliveries(createConfig(), requester);

    expect(requester).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/send',
      body: { content: '', files: ['/tmp/image.png'] },
      timeoutMs: 60000,
    }));
    expect(result.delivered).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(getPendingDeliveries()).toHaveLength(0);
  });

  it('keeps the original delivery pending when the retry still fails', async () => {
    recordPendingDelivery('reply', {
      channel_id: 'ch1',
      message_id: 'm1',
      content: '',
      files: ['/tmp/image.png'],
    }, 'daemon_offline');

    const requester = vi.fn(async () => ({
      ok: false,
      status: 403,
      data: { error: 'Channel ch1 is not allowed for replies' },
    })) satisfies DeliveryRequester;

    const result = await retryPendingDeliveries(createConfig(), requester);
    const [pending] = getPendingDeliveries();

    expect(result.delivered).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(pending).toMatchObject({
      kind: 'reply',
      attempts: 2,
      lastError: 'Channel ch1 is not allowed for replies',
    });
  });

  it('formats failures as pending work rather than completed troubleshooting', () => {
    const text = pendingDeliveryFailureText('Send', 'daemon_offline');

    expect(text).toContain('original Discord action is still pending');
    expect(text).toContain('Troubleshooting is not completion');
    expect(text).toContain('retry this same action');
  });

  it('summarizes a successful pending retry as delivered', () => {
    const summary = formatPendingDeliveryRetryResult({
      attempted: 1,
      delivered: [{
        id: 'send:{}',
        kind: 'send',
        path: '/send',
        body: {},
        firstFailureAt: '2026-01-01T00:00:00.000Z',
        lastFailureAt: '2026-01-01T00:00:00.000Z',
        lastError: 'daemon_offline',
        attempts: 1,
      }],
      failed: [],
    });

    expect(summary).toContain('Retried and delivered 1 pending Discord delivery');
  });

  it('retries non-message Discord actions on their original API path', async () => {
    recordPendingDelivery('schedule', { message: 'standup', delay_minutes: 10 }, 'daemon_offline');

    const requester = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { ok: true, job_id: 'job1' },
    })) satisfies DeliveryRequester;

    await retryPendingDeliveries(createConfig(), requester);

    expect(requester).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/cron',
      body: { message: 'standup', delay_minutes: '10' },
    }));
    expect(getPendingDeliveries()).toHaveLength(0);
  });
});
