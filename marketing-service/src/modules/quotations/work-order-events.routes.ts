import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { quotationRepository } from './quotation.repository.js';

/**
 * Service-to-service Work Order link state delivered by Field Service.
 *
 * The event is idempotent in both directions: a retried link/unlink for the same
 * Work Order is acknowledged without changing the quotation again, while a link
 * for a different Work Order than the one currently referenced is rejected so a
 * late callback can never overwrite a newer reference.
 */
export const workOrderSyncEventSchema = z.object({
  workOrderId: z.string().uuid(),
  quotationId: z.string().uuid(),
  officeBranchId: z.string().uuid(),
  revoked: z.boolean(),
  workOrderSnapshot: z.object({ number: z.string().min(1).max(100), status: z.string().min(1).max(50) }).catchall(z.unknown()),
}).strict();
export type WorkOrderSyncEvent = z.infer<typeof workOrderSyncEventSchema>;

export async function applyWorkOrderSyncEvent(input: unknown) {
  const parsed = workOrderSyncEventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Invalid Work Order sync event', 400);
  const { workOrderId, quotationId, officeBranchId, revoked, workOrderSnapshot } = parsed.data;
  const workOrder = { id: workOrderId, number: workOrderSnapshot.number, status: workOrderSnapshot.status, quotationId, officeBranchId, revoked };
  if (revoked) await quotationRepository.clearWorkOrder(quotationId, officeBranchId, workOrderId);
  else await quotationRepository.attachWorkOrder(quotationId, officeBranchId, workOrder, { id: workOrderId, name: 'Field Service' });
  return { success: true, workOrderId, quotationId, revoked };
}

const router = Router();
router.post('/internal/work-orders/events', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-work-order-sync-secret'];
  const expected = env.WORK_ORDER_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(403).json({ success: false, message: 'Invalid Work Order delivery credentials' }); return;
  }
  res.json(await applyWorkOrderSyncEvent(req.body));
}));
export default router;
