import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';

const date = z.string().datetime();
// Unknown keys are accepted on purpose: the whole Auth snapshot is stored as one
// JSON document, so a future Auth column must reach the read model instead of
// being rejected as an invalid event. The known fields stay strictly typed,
// and the event identity (id/version/branch) is still verified below.
const userSnapshotSchema = z.object({
  id: z.string().uuid(), username: z.string().min(1).max(255),
  firstName: z.string().max(255), lastName: z.string().max(255),
  email: z.string().email().max(255).nullable(), telp: z.string().max(50).nullable(),
  role: z.enum(['USER', 'ADMIN', 'APP_MANAGER']),
  section: z.enum(['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE']).nullable(),
  officeBranchId: z.string().uuid().nullable(), isActive: z.boolean(),
  version: z.number().int().positive(), createdAt: date, updatedAt: date,
}).passthrough();
const eventSchema = z.object({
  eventId: z.string().uuid(), officeBranchId: z.string().uuid().nullable(),
  version: z.number().int().positive(), user: userSnapshotSchema,
}).passthrough().superRefine((event, ctx) => {
  if (event.user.officeBranchId !== event.officeBranchId) ctx.addIssue({ code: 'custom', message: 'User branch does not match event branch' });
  if (event.user.version !== event.version) ctx.addIssue({ code: 'custom', message: 'User version does not match event version' });
});
const isCandidate = (user: z.infer<typeof userSnapshotSchema>) =>
  user.section === 'FIELD_SERVICE' && user.isActive && Boolean(user.officeBranchId);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function applyFieldServiceUserSyncEvent(input: unknown) {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Invalid user sync event', 400);
  const event = parsed.data;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'fieldservice-user-sync:' + event.user.id}))`;
    const current = await tx.fieldServiceUserSyncRevision.findUnique({ where: { userId: event.user.id } });
    if (current && current.version >= event.version) return;

    if (isCandidate(event.user) && event.officeBranchId) {
      const source = {
        officeBranchId: event.officeBranchId,
        user: json(event.user),
        sourceVersion: event.version,
        sourceCreatedAt: event.user.createdAt,
        sourceUpdatedAt: event.user.updatedAt,
      };
      await tx.fieldServiceUser.upsert({
        where: { id: event.user.id },
        create: { id: event.user.id, ...source },
        update: source,
      });
    } else {
      await tx.fieldServiceUser.deleteMany({ where: { id: event.user.id } });
    }

    await tx.fieldServiceUserSyncRevision.upsert({
      where: { userId: event.user.id },
      create: { userId: event.user.id, version: event.version, eventId: event.eventId },
      update: { version: event.version, eventId: event.eventId },
    });
  }, { maxWait: 5000, timeout: 20000 });
  return { success: true, eventId: event.eventId };
}

export async function listInspectorOptions(officeBranchId: string) {
  const rows = await prisma.fieldServiceUser.findMany({
    where: { officeBranchId },
    select: { user: true },
    orderBy: [{ sourceCreatedAt: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  // Consumers read the raw Auth snapshot; the eligibility filter (active,
  // FIELD_SERVICE, branch) is enforced by the sync receiver, not here.
  return rows.flatMap(({ user }) =>
    user && typeof user === 'object' && !Array.isArray(user) ? [user] : []);
}
