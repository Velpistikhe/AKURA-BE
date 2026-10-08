import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Persist the full approved quotation as an outbox event in the approval transaction. */
export type QuotationSyncCommit = { syncEventId: string; officeBranchId: string };

/**
 * Attempts immediate delivery of one committed event and wakes the retry worker.
 * Never throws: the outbox row stays queued for the next invocation.
 */
export async function dispatchQuotationSync(eventId: string, officeBranchId: string): Promise<void> {
  await processDueQuotationDeliveries(officeBranchId, eventId);
  wakeQuotationDelivery();
}

export async function enqueueQuotationSnapshot(tx: Prisma.TransactionClient, input: {
  id: string; officeBranchId: string; version: number; revision: number; payload: unknown; approvedAt: Date;
}) {
  const last = await tx.quotationSyncEvent.findFirst({ where: { quotationId: input.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const eventVersion = (last?.version ?? 0) + 1;
  return tx.quotationSyncEvent.create({ data: {
    officeBranchId: input.officeBranchId, quotationId: input.id, quotationVersion: input.version,
    version: eventVersion, revision: input.revision, payload: json(input.payload), approvedAt: input.approvedAt,
    deliveries: { create: env.QUOTATION_SYNC_TARGETS.map(target => ({ targetService: target.name })) },
  } });
}

/**
 * Publishes the current state of a quotation that is no longer usable as a work
 * order basis (revise, deactivate or restore). The monotonic event version makes
 * Field Service replace its stored snapshot with the same lifecycle state.
 * Quotations that were never approved have no prior event and are skipped.
 */
export async function enqueueQuotationStateSync(tx: Prisma.TransactionClient, quote: {
  id: string; officeBranchId: string; version: number; revision: number;
}, payload: unknown, approvedAt: Date) {
  const published = await tx.quotationSyncEvent.findFirst({ where: { quotationId: quote.id }, select: { id: true } });
  if (!published) return null;
  return enqueueQuotationSnapshot(tx, { id: quote.id, officeBranchId: quote.officeBranchId,
    version: quote.version, revision: quote.revision, payload, approvedAt });
}

export const retryDelay = (attempt: number) => Math.min(300000, 10000 * 2 ** Math.min(attempt - 1, 5));

/** Durable, concurrency-safe outbox delivery. */
export async function deliverQuotationSync(id: string) {
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS acquired`;
    if (!lock.acquired) return;
    const job = await tx.quotationSyncDelivery.findUnique({ where: { id }, include: { event: true } });
    if (!job || job.deliveredAt || job.nextRetryAt > new Date()) return;
    const target = env.QUOTATION_SYNC_TARGETS.find(target => target.name === job.targetService);
    const path = 'fieldservice/internal/quotation-snapshots/events';
    try {
      if (!target || !env.QUOTATION_SYNC_SECRET) throw new Error('Delivery target or credential is not configured');
      if (target.url !== `${env.API_GATEWAY_URL}/api/v1/${path}`) throw new Error('Quotation sync target must use the configured API Gateway');
      const response = await fetch(target.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', 'x-quotation-sync-secret': env.QUOTATION_SYNC_SECRET,
          'x-service-name': 'marketing-service', 'x-service-secret': env.GATEWAY_SECRET },
        body: JSON.stringify({ eventId: job.eventId, officeBranchId: job.event.officeBranchId,
          quotationId: job.event.quotationId, quotationVersion: job.event.quotationVersion,
          version: job.event.version, revision: job.event.revision, approvedAt: job.event.approvedAt.toISOString(),
          quotation: job.event.payload }),
      });
      if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
      const ack = await response.json() as { eventId?: string; success?: boolean };
      if (ack.eventId !== job.eventId || ack.success !== true) throw new Error('Invalid delivery acknowledgment');
      await tx.quotationSyncDelivery.update({ where: { id }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (error) {
      await tx.quotationSyncDelivery.update({ where: { id }, data: { attempts: { increment: 1 },
        nextRetryAt: new Date(Date.now() + retryDelay(job.attempts + 1) + Math.floor(Math.random() * 1000)),
        lastError: error instanceof Error ? error.message : 'Delivery failed' } });
      logger.warn('Quotation snapshot delivery failed; automatic retry scheduled', { deliveryId: id, target: job.targetService });
    }
  }, { timeout: 20000, maxWait: 5000 });
}

export async function processDueQuotationDeliveries(officeBranchId: string, eventId?: string): Promise<void> {
  try {
    const jobs = await prisma.quotationSyncDelivery.findMany({
      where: { deliveredAt: null, nextRetryAt: { lte: new Date() }, event: { officeBranchId }, ...(eventId ? { eventId } : {}) },
      orderBy: { nextRetryAt: 'asc' }, ...(eventId ? {} : { take: 5 }), select: { id: true },
    });
    const results = await Promise.allSettled(jobs.map(job => deliverQuotationSync(job.id)));
    if (results.some(result => result.status === 'rejected')) logger.error('Quotation delivery batch interrupted; pending entries will retry');
  } catch {
    // Approval and outbox are committed; do not make clients retry an approval.
    logger.error('Quotation delivery batch unavailable; pending entries remain queued');
  }
}

let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = true;
let requested = false;
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
    const jobs = await prisma.quotationSyncDelivery.findMany({ where: { deliveredAt: null, nextRetryAt: { lte: new Date() } }, orderBy: { nextRetryAt: 'asc' }, take: 20 });
    for (const job of jobs) { if (stopped) break; await deliverQuotationSync(job.id); }
    const next = await prisma.quotationSyncDelivery.findFirst({ where: { deliveredAt: null }, orderBy: { nextRetryAt: 'asc' } });
    if (next) schedule(Math.max(1000, next.nextRetryAt.getTime() - Date.now()));
  } catch { logger.error('Quotation delivery worker failed; recovery scheduled'); schedule(10000); }
  finally { running = false; if (requested) schedule(0); }
}
export function wakeQuotationDelivery() { requested = true; if (!running) schedule(0); }
export function startQuotationDelivery() {
  stopped = false;
  wakeQuotationDelivery();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

