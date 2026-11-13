import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';

let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = true;
let requested = false;

export const retryDelay = (attempt: number) => Math.min(300000, 10000 * 2 ** Math.min(attempt - 1, 5));

export async function deliverWorkOrderLink(id: string) {
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS acquired`;
    if (!lock.acquired) return;
    const job = await tx.workOrderLinkDelivery.findUnique({ where: { id }, include: { event: true } });
    if (!job || job.deliveredAt || job.nextRetryAt > new Date()) return;
    try {
      if (!env.WORK_ORDER_SYNC_SECRET) throw new Error('Work Order delivery credentials are not configured');
      const path = `marketing/internal/quotations/${job.event.quotationId}/work-order`;
      const response = await fetch(serviceUrl(path), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          'x-work-order-sync-secret': env.WORK_ORDER_SYNC_SECRET,
          ...serviceHeaders(path),
        },
        body: JSON.stringify(job.event.payload),
      });
      if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
      const ack = await response.json() as { success?: boolean; workOrderId?: string };
      const payload = job.event.payload as { workOrderId?: string };
      if (ack.success !== true || ack.workOrderId !== payload.workOrderId) throw new Error('Invalid delivery acknowledgment');
      await tx.workOrderLinkDelivery.update({
        where: { id },
        data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (error) {
      await tx.workOrderLinkDelivery.update({
        where: { id },
        data: {
          attempts: { increment: 1 },
          nextRetryAt: new Date(Date.now() + retryDelay(job.attempts + 1) + Math.floor(Math.random() * 1000)),
          lastError: error instanceof Error ? error.message : 'Delivery failed',
        },
      });
      logger.warn('Work Order link delivery failed; automatic retry scheduled', { deliveryId: id, quotationId: job.event.quotationId });
    }
  }, { timeout: 20000, maxWait: 5000 });
}

export async function processDueWorkOrderLinkDeliveries(officeBranchId: string, eventId?: string): Promise<void> {
  try {
    const jobs = await prisma.workOrderLinkDelivery.findMany({
      where: {
        deliveredAt: null,
        nextRetryAt: { lte: new Date() },
        event: { officeBranchId },
        ...(eventId ? { eventId } : {}),
      },
      orderBy: { nextRetryAt: 'asc' },
      ...(eventId ? {} : { take: 5 }),
      select: { id: true },
    });
    const results = await Promise.allSettled(jobs.map(job => deliverWorkOrderLink(job.id)));
    if (results.some(result => result.status === 'rejected')) {
      logger.error('Work Order link delivery batch interrupted; pending entries will be retried on the next invocation');
    }
  } catch {
    logger.error('Work Order link delivery batch unavailable; pending entries remain queued');
  }
}

function schedule(delay: number) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void run(); }, Math.min(2147483647, Math.max(0, delay)));
}

async function run() {
  if (running || stopped) return;
  running = true;
  requested = false;
  try {
    const jobs = await prisma.workOrderLinkDelivery.findMany({
      where: { deliveredAt: null, nextRetryAt: { lte: new Date() } },
      orderBy: { nextRetryAt: 'asc' },
      take: 20,
    });
    for (const job of jobs) {
      if (stopped) break;
      await deliverWorkOrderLink(job.id);
    }
    const next = await prisma.workOrderLinkDelivery.findFirst({
      where: { deliveredAt: null },
      orderBy: { nextRetryAt: 'asc' },
    });
    if (next) schedule(Math.max(1000, next.nextRetryAt.getTime() - Date.now()));
  } catch {
    logger.error('Work Order link delivery worker failed; recovery scheduled');
    schedule(10000);
  } finally {
    running = false;
    if (requested) schedule(0);
  }
}

export function wakeWorkOrderLinkDelivery() {
  requested = true;
  if (!running) schedule(0);
}

export function startWorkOrderLinkDelivery() {
  stopped = false;
  wakeWorkOrderLinkDelivery();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
