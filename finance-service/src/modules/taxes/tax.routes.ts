import { Router } from 'express';
import { prisma } from '../../config/db.js';
import { requireActor, Actor } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { taxRepository, enqueueTaxSnapshot } from './tax.repository.js';
import { processDueTaxDeliveries, wakeTaxDelivery } from './tax-delivery.js';
import { z } from 'zod';

const router = Router();
router.use(requireActor);
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
router.get('/', asyncHandler(async (req, res) => {
  const actor: Actor = res.locals.documentActor;
  const { page, limit } = querySchema.parse(req.query);
  const data = await prisma.tax.findMany({ where: { officeBranchId: actor.officeBranchId }, orderBy: { effectiveFrom: 'desc' }, take: limit, skip: (page - 1) * limit });
  res.json({ success: true, status: 200, data });
}));
router.get('/deliveries', asyncHandler(async (req, res) => {
  const actor: Actor = res.locals.documentActor;
  const { page, limit } = querySchema.parse(req.query);
  await processDueTaxDeliveries(actor.officeBranchId);
  const data = await prisma.taxDelivery.findMany({ where: { event: { officeBranchId: actor.officeBranchId } },
    orderBy: [{ event: { version: 'desc' } }, { id: 'asc' }], take: limit, skip: (page - 1) * limit });
  res.json({ success: true, status: 200, data });
}));
router.use((_req, res, next) => {
  if (!res.locals.taxWriteAllowed) return next(new HttpError('ADMIN role and FINANCE or MARKETING section are required', 403));
  next();
});
router.post('/', asyncHandler(async (req, res) => {
  const actor: Actor = res.locals.documentActor;
  const { tax: data, event } = await taxRepository.createWithEvent(req.body, actor.officeBranchId, actor);
  await processDueTaxDeliveries(actor.officeBranchId, event.id);
  wakeTaxDelivery();
  res.status(201).json({ status: 201, success: true, message: 'Tax saved; cache delivery queued', data, requestId: req.headers['x-request-id'] });
}));
// Bootstrap a new/restored consumer, or republish after repairing configuration.
router.post('/resync', asyncHandler(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  const actor: Actor = res.locals.documentActor;
  const event = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax-branch:' + actor.officeBranchId}))`;
    return enqueueTaxSnapshot(tx, actor.officeBranchId);
  });
  await processDueTaxDeliveries(actor.officeBranchId, event.id);
  wakeTaxDelivery();
  res.status(202).json({ status: 202, success: true, data: { eventId: event.id, version: event.version }, message: 'Cache delivery queued' });
}));
export default router;
