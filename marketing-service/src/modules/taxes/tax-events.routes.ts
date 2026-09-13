import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';

const date = z.string().datetime().transform(value => new Date(value));
export const taxEventSchema = z.object({
  eventId: z.string().uuid(), officeBranchId: z.string().uuid(), version: z.number().int().positive(),
  taxes: z.array(z.object({ id: z.string().uuid(), officeBranchId: z.string().uuid(),
    percentage: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine(value => Number(value) <= 100),
    effectiveFrom: date, effectiveUntil: date.nullable(), updatedAt: date }).strict()),
}).strict().superRefine((event, ctx) => {
  const rows = [...event.taxes].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate tax IDs' });
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (row.officeBranchId !== event.officeBranchId || (row.effectiveUntil && row.effectiveUntil < row.effectiveFrom)
      || (previous && (!previous.effectiveUntil || previous.effectiveUntil >= row.effectiveFrom))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid branch or overlapping tax periods' });
    }
  });
});
export async function applyTaxEvent(input: unknown) {
  const parsed = taxEventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Invalid tax event', 400);
  const event = parsed.data;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax-cache:' + event.officeBranchId}))`;
    const current = await tx.taxCacheRevision.findUnique({ where: { officeBranchId: event.officeBranchId } });
    if (current && current.version >= event.version) return;
    await tx.taxCache.deleteMany({ where: { officeBranchId: event.officeBranchId } });
    if (event.taxes.length) await tx.taxCache.createMany({ data: event.taxes.map(({ updatedAt, ...row }) => ({ ...row, sourceUpdatedAt: updatedAt })) });
    await tx.taxCacheRevision.upsert({ where: { officeBranchId: event.officeBranchId },
      create: { officeBranchId: event.officeBranchId, version: event.version, eventId: event.eventId },
      update: { version: event.version, eventId: event.eventId } });
  });
  return { success: true, eventId: event.eventId };
}
const router = Router();
router.post('/internal/taxes/events', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-tax-sync-secret'];
  const expected = env.TAX_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(403).json({ success: false, message: 'Invalid tax delivery credentials' }); return;
  }
  res.json(await applyTaxEvent(req.body));
}));
export default router;
