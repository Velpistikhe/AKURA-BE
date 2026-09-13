import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = true;
let requested = false;
export const retryDelay = (attempt: number) => Math.min(300000, 10000 * 2 ** Math.min(attempt - 1, 5));

// The transaction lock prevents simultaneous delivery by multiple Finance instances.
export async function deliverTax(id: string) {
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS acquired`;
    if (!lock.acquired) return;
    const job = await tx.taxDelivery.findUnique({ where: { id }, include: { event: true } });
    if (!job || job.deliveredAt || job.nextRetryAt > new Date()) return;
    const target = env.TAX_DELIVERY_TARGETS.find(target => target.name === job.targetService);
    try {
      if (!target || !env.TAX_SYNC_SECRET) throw new Error('Delivery target or credential is not configured');
      const response = await fetch(target.url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', 'x-tax-sync-secret': env.TAX_SYNC_SECRET },
        body: JSON.stringify({ eventId: job.eventId, officeBranchId: job.event.officeBranchId,
          version: job.event.version, taxes: job.event.payload }),
      });
      if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
      const ack = await response.json() as { eventId?: string; success?: boolean };
      if (ack.eventId !== job.eventId || ack.success !== true) throw new Error('Invalid delivery acknowledgment');
      await tx.taxDelivery.update({ where: { id }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (error) {
      await tx.taxDelivery.update({ where: { id }, data: { attempts: { increment: 1 },
        nextRetryAt: new Date(Date.now() + retryDelay(job.attempts + 1) + Math.floor(Math.random() * 1000)),
        lastError: error instanceof Error ? error.message : 'Delivery failed' } });
      logger.warn('Tax delivery failed; automatic retry scheduled', { deliveryId: id, target: job.targetService });
    }
  }, { timeout: 20000, maxWait: 5000 });
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
    const jobs = await prisma.taxDelivery.findMany({ where: { deliveredAt: null, nextRetryAt: { lte: new Date() } }, orderBy: { nextRetryAt: 'asc' }, take: 20 });
    for (const job of jobs) { if (stopped) break; await deliverTax(job.id); }
    const next = await prisma.taxDelivery.findFirst({ where: { deliveredAt: null }, orderBy: { nextRetryAt: 'asc' } });
    if (next) schedule(Math.max(1000, next.nextRetryAt.getTime() - Date.now()));
  } catch {
    logger.error('Tax delivery worker failed; recovery scheduled');
    schedule(10000);
  } finally {
    running = false;
    if (requested) schedule(0);
  }
}
export function wakeTaxDelivery() { requested = true; if (!running) schedule(0); }
export function startTaxDelivery() {
  stopped = false;
  wakeTaxDelivery(); // Recover committed outbox entries after restart.
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
