import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { applyQuotationSyncEvent } from './quotation-snapshot.repository.js';

const router = Router();
/**
 * Receives APPROVED quotation snapshots from Marketing through the API Gateway.
 * The gateway injects the Field Service gateway secret and requires Marketing
 * service credentials; this handler additionally verifies the shared sync secret.
 */
router.post('/internal/quotation-snapshots/events', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-quotation-sync-secret'];
  const expected = env.QUOTATION_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(403).json({ success: false, message: 'Invalid quotation snapshot delivery credentials' }); return;
  }
  res.json(await applyQuotationSyncEvent(req.body));
}));
export default router;
