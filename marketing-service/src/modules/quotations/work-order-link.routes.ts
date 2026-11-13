import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { quotationRepository, workOrderStatusMirror } from './quotation.repository.js';

/**
 * Quotation ↔ Work Order link update delivered by Field Service.
 *
 * Field Service owns the Work Order. Marketing owns the quotation, so it keeps
 * a mirrored reference: `hasWorkOrder` marks the quotation as backing a live
 * Work Order and `workOrderId` points at that Work Order.
 *
 * The payload is idempotent in both directions: re-sending the same Work Order
 * acknowledges without changing the quotation again, while a link for a
 * different Work Order than the one currently referenced is rejected so a late
 * callback can never overwrite a newer reference.
 */
export const workOrderLinkSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNumber: z.string().min(1).max(100),
  workOrderStatus: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']),
  officeBranchId: z.string().uuid(),
  workOrderSnapshot: z.record(z.unknown()).optional(),
  // True when the Work Order was revoked: the quotation reference is cleared.
  revoked: z.boolean().default(false),
}).strict();
export type WorkOrderLink = z.infer<typeof workOrderLinkSchema>;

const router = Router();
router.post('/internal/quotations/:quotationId/work-order', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-work-order-sync-secret'];
  const expected = env.WORK_ORDER_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(403).json({ success: false, message: 'Invalid Work Order delivery credentials' }); return;
  }
  const quotationId = z.string().uuid().parse(req.params.quotationId);
  const parsed = workOrderLinkSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError('Invalid Work Order link request', 400);
  const { workOrderId, workOrderNumber, workOrderStatus, officeBranchId, workOrderSnapshot, revoked } = parsed.data;
  if (revoked) {
    // A revoked Work Order clears the whole reference.
    await quotationRepository.clearWorkOrder(quotationId, officeBranchId, workOrderId);
    res.json({ success: true, quotationId, workOrderId, revoked: true, workOrderStatus: null });
    return;
  }
  // A canceled Work Order clears the mirrored status instead of storing one it
  // does not have.
  const workOrder = { id: workOrderId, number: workOrderNumber, status: workOrderStatus, quotationId, officeBranchId };
  await quotationRepository.attachWorkOrder(quotationId, officeBranchId, workOrder, workOrderSnapshot, { id: workOrderId, name: 'Field Service' });
  res.json({ success: true, quotationId, workOrderId, revoked: false, workOrderStatus: workOrderStatusMirror(workOrderStatus) });
}));
export default router;
