import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { logger } from '../../utils/logger.js';

const date = z.string().datetime().transform(value => new Date(value));
const userSnapshotSchema = z.object({
  id: z.string().uuid(), username: z.string().min(1).max(255),
  firstName: z.string().max(255), lastName: z.string().max(255),
  email: z.string().email().max(255).nullable(), telp: z.string().max(50).nullable(),
  role: z.enum(['USER', 'ADMIN', 'APP_MANAGER']),
  section: z.enum(['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE']).nullable(),
  officeBranchId: z.string().uuid().nullable(), isActive: z.boolean(),
  version: z.number().int().positive(), createdAt: date, updatedAt: date,
}).strict();
export const userSyncEventSchema = z.object({
  eventId: z.string().uuid(), officeBranchId: z.string().uuid().nullable(), version: z.number().int().positive(),
  user: userSnapshotSchema,
}).strict().superRefine((event, ctx) => {
  if (event.user.officeBranchId !== event.officeBranchId) {
    ctx.addIssue({ code: 'custom', message: 'Invalid user event identity or branch' });
  }
  if (event.user.version !== event.version) ctx.addIssue({ code: 'custom', message: 'Event and user versions differ' });
});

const isCandidate = (user: z.infer<typeof userSnapshotSchema>) =>
  user.role === 'ADMIN' && user.section === 'MARKETING' && user.isActive && Boolean(user.officeBranchId);

// The full snapshot travels as one JSON document: branch and version stay as
// columns for identity/concurrency, every other field lives inside `user`.
const snapshotJson = (user: z.infer<typeof userSnapshotSchema>) =>
  JSON.parse(JSON.stringify(user)) as Prisma.InputJsonValue;

export async function applyUserSyncEvent(input: unknown) {
  const parsed = userSyncEventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Invalid user sync event', 400);
  const event = parsed.data;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'user-sync:' + event.user.id}))`;
    const current = await tx.marketingUserSyncRevision.findUnique({ where: { userId: event.user.id } });
    if (current && current.version >= event.version) return;

    const source = {
      sourceVersion: event.version,
      sourceCreatedAt: event.user.createdAt,
      sourceUpdatedAt: event.user.updatedAt,
    };
    if (isCandidate(event.user) && event.officeBranchId) {
      const branchId = event.officeBranchId;
      await tx.marketingAdminUser.upsert({
        where: { id: event.user.id },
        create: { id: event.user.id, officeBranchId: branchId, user: snapshotJson(event.user), ...source },
        update: { officeBranchId: branchId, user: snapshotJson(event.user), ...source },
      });
    } else {
      await tx.marketingAdminUser.deleteMany({ where: { id: event.user.id } });
    }
    await tx.marketingUserSyncRevision.upsert({
      where: { userId: event.user.id },
      create: { userId: event.user.id, version: event.version, eventId: event.eventId },
      update: { version: event.version, eventId: event.eventId },
    });
  }, { maxWait: 5000, timeout: 20000 });
  logger.info('User sync event applied', { eventId: event.eventId, userId: event.user.id, officeBranchId: event.officeBranchId, version: event.version, eligible: isCandidate(event.user) });
  return { success: true, eventId: event.eventId };
}

const router = Router();
router.post('/internal/users/events', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-user-sync-secret'];
  const expected = env.USER_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(403).json({ success: false, message: 'Invalid user sync delivery credentials' }); return;
  }
  res.json(await applyUserSyncEvent(req.body));
}));
export default router;
