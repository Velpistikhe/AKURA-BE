import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';
import { isUserSyncConfigured, UserSyncSnapshot, UserSyncTarget } from './user-sync.service.js';

const USER_SYNC_PATHS: Record<UserSyncTarget, string> = {
  'marketing-service': 'marketing/internal/users/events',
  'fieldservice-service': 'fieldservice/internal/users/events',
};
let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = true;
let requested = false;
export const retryDelay = (attempt: number) => Math.min(300000, 10000 * 2 ** Math.min(attempt - 1, 5));

// Advisory transaction lock prevents simultaneous delivery across Auth instances.
export async function deliverUserSync(id: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS acquired`;
    if (!lock.acquired) return;
    const job = await tx.userSyncDelivery.findUnique({ where: { id }, include: { event: true } });
    if (!job || job.deliveredAt || job.nextRetryAt > new Date()) return;
    try {
      if (!isUserSyncConfigured()) throw new Error('User sync delivery is not configured');
      const path = USER_SYNC_PATHS[job.targetService as UserSyncTarget];
      if (!path) throw new Error(`Unknown user sync target ${job.targetService}`);
      const payload = job.event.payload as unknown as UserSyncSnapshot;
      const response = await fetch(serviceUrl(path), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', 'x-user-sync-secret': env.USER_SYNC_SECRET!, ...serviceHeaders(path) },
        body: JSON.stringify({ eventId: job.eventId, officeBranchId: payload.officeBranchId, version: job.event.version, user: payload }),
      });
      if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
      const ack = await response.json() as { eventId?: string; success?: boolean };
      if (ack.eventId !== job.eventId || ack.success !== true) throw new Error('Invalid delivery acknowledgment');
      await tx.userSyncDelivery.update({ where: { id }, data: { deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      logger.info('User sync delivered', { deliveryId: id, eventId: job.eventId, userId: job.event.userId, target: job.targetService });
    } catch (error) {
      await tx.userSyncDelivery.update({ where: { id }, data: { attempts: { increment: 1 },
        nextRetryAt: new Date(Date.now() + retryDelay(job.attempts + 1) + Math.floor(Math.random() * 1000)),
        lastError: error instanceof Error ? error.message : 'Delivery failed' } });
      logger.warn('User sync delivery failed; automatic retry scheduled', { deliveryId: id, eventId: job.eventId, userId: job.event.userId, target: job.targetService, error: error instanceof Error ? error.message : 'Delivery failed' });
    }
  }, { timeout: 20000, maxWait: 5000 });
}

// Runs a bounded batch inside the HTTP invocation so committed events are
// pushed even when the timer worker is not running (serverless/app import).
export async function processDueUserSyncs(userId?: string): Promise<void> {
  try {
    const jobs = await prisma.userSyncDelivery.findMany({
      where: { deliveredAt: null, nextRetryAt: { lte: new Date() }, ...(userId ? { event: { userId } } : {}) },
      orderBy: { nextRetryAt: 'asc' }, ...(userId ? {} : { take: 5 }), select: { id: true },
    });
    const results = await Promise.allSettled(jobs.map(job => deliverUserSync(job.id)));
    if (results.some(result => result.status === 'rejected')) {
      logger.error('User sync delivery batch interrupted; pending entries will be retried on the next invocation');
    }
  } catch {
    logger.error('User sync delivery batch unavailable; pending entries remain queued');
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
    const jobs = await prisma.userSyncDelivery.findMany({ where: { deliveredAt: null, nextRetryAt: { lte: new Date() } }, orderBy: { nextRetryAt: 'asc' }, take: 20 });
    for (const job of jobs) { if (stopped) break; await deliverUserSync(job.id); }
    const next = await prisma.userSyncDelivery.findFirst({ where: { deliveredAt: null }, orderBy: { nextRetryAt: 'asc' } });
    if (next) schedule(Math.max(1000, next.nextRetryAt.getTime() - Date.now()));
  } catch {
    logger.error('User sync worker failed; recovery scheduled');
    schedule(10000);
  } finally {
    running = false;
    if (requested) schedule(0);
  }
}
export function wakeUserSync() { requested = true; if (!running) schedule(0); }
export function startUserSync() {
  stopped = false;
  wakeUserSync(); // Recover committed outbox entries after restart.
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
